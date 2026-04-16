const fs = require('fs');
const path = require('path');
const https = require('https');

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const { configureWebPush, sendNotification } = require('./push');

const app = express();
const PORT = Number(process.env.PORT || 3443);

app.use(cors());
app.use(express.json());

// --- Статика (клиент PWA) ---
const FRONTEND_DIR = path.join(__dirname, '..', '..');

// Читаем index.html для подстановки VAPID ключа
const indexPath = path.join(FRONTEND_DIR, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');

if (process.env.VAPID_PUBLIC_KEY) {
  indexHtml = indexHtml.replace(/content="ВАШ_VAPID_PUBLIC_KEY"/g, `content="${process.env.VAPID_PUBLIC_KEY}"`);
  indexHtml = indexHtml.replace(/ВАШ_VAPID_PUBLIC_KEY/g, process.env.VAPID_PUBLIC_KEY);
  console.log('[SERVER] VAPID public key injected');
}

app.get('/', (req, res) => {
  res.send(indexHtml);
});

app.use(express.static(FRONTEND_DIR));

// =====================================================
// HEALTH CHECK
// =====================================================

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// =====================================================
// PUSH (VAPID + subscriptions)
// =====================================================

const subscriptions = new Set();

let pushReady = false;
try {
  configureWebPush({
    subject: process.env.VAPID_SUBJECT,
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
  });
  pushReady = true;
  console.log('[PUSH] Configured');
} catch (e) {
  console.warn('[PUSH] Not configured:', e.message);
}

app.get('/api/push/vapid-public-key', (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(400).json({ error: 'push_not_configured', message: 'Set VAPID_PUBLIC_KEY in server/.env' });
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY, pushReady });
});

app.post('/api/push/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription) {
    return res.status(400).json({ error: 'subscription_required' });
  }
  subscriptions.add(JSON.stringify(subscription));
  console.log(`[PUSH] Subscription saved. Total: ${subscriptions.size}`);
  res.json({ ok: true, count: subscriptions.size, pushReady });
});

app.post('/api/push/test', async (req, res) => {
  if (!pushReady) {
    return res.status(400).json({ error: 'push_not_configured', message: 'Set VAPID keys in server/.env' });
  }

  const payload = JSON.stringify({
    title: 'PWA уведомление',
    body: 'Тестовое уведомление (ПР17)',
    url: '/',
    ts: Date.now(),
  });

  let sent = 0;
  for (const raw of Array.from(subscriptions)) {
    const subscription = JSON.parse(raw);
    try {
      await sendNotification(subscription, payload);
      sent++;
    } catch (e) {
      console.warn('[PUSH] send failed:', e.statusCode || '', e.message);
      if (e.statusCode === 410) {
        subscriptions.delete(raw);
      }
    }
  }

  res.json({ ok: true, sent, total: subscriptions.size });
});

// =====================================================
// ПР17: ОТЛОЖЕННЫЕ PUSH УВЕДОМЛЕНИЯ
// =====================================================

const reminders = new Map();
const reminderTimers = new Map();

function scheduleReminderTimer(reminder) {
  const prev = reminderTimers.get(reminder.id);
  if (prev) clearTimeout(prev);

  const delayMs = Math.max(0, reminder.fireAt - Date.now());
  console.log(`[REMINDER] Scheduling ${reminder.id} in ${delayMs}ms`);

  const t = setTimeout(async () => {
    if (!pushReady) {
      console.warn('[REMINDER] push not configured');
      return;
    }

    const payload = JSON.stringify({
      title: reminder.title,
      body: reminder.body,
      url: '/',
      reminderId: reminder.id,
      actions: ['snooze_5m'],
      ts: Date.now(),
    });

    let sent = 0;
    for (const raw of Array.from(subscriptions)) {
      const subscription = JSON.parse(raw);
      try {
        await sendNotification(subscription, payload);
        sent++;
      } catch (e) {
        console.warn('[PUSH] send failed:', e.statusCode || '', e.message);
      }
    }

    console.log(`[REMINDER] Sent ${sent} notifications for ${reminder.id}`);
  }, delayMs);

  reminderTimers.set(reminder.id, t);
}

app.post('/api/reminders/schedule', (req, res) => {
  const { title, body, delaySeconds } = req.body || {};

  if (!title || typeof delaySeconds !== 'number') {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Нужны поля: title (string), delaySeconds (number)'
    });
  }

  const id = nanoid(10);
  const now = Date.now();
  const fireAt = now + Math.max(0, delaySeconds) * 1000;

  const reminder = {
    id,
    title: String(title),
    body: body ? String(body) : 'Напоминание (ПР17)',
    createdAt: now,
    fireAt,
  };

  reminders.set(id, reminder);
  scheduleReminderTimer(reminder);

  res.json({ ok: true, reminder });
});

app.post('/api/reminders/snooze', (req, res) => {
  const { reminderId, minutes } = req.body || {};

  if (!reminderId) {
    return res.status(400).json({ error: 'validation_error', message: 'Нужно поле reminderId' });
  }

  const reminder = reminders.get(reminderId);
  if (!reminder) {
    return res.status(404).json({ error: 'not_found', message: 'Напоминание не найдено' });
  }

  const m = typeof minutes === 'number' ? minutes : 5;
  reminder.fireAt = Date.now() + Math.max(0, m) * 60 * 1000;
  reminders.set(reminder.id, reminder);
  scheduleReminderTimer(reminder);

  console.log(`[REMINDER] Snoozed ${reminderId} for ${m} minutes`);
  res.json({ ok: true, reminder });
});

// =====================================================
// HTTPS + SOCKET.IO
// =====================================================

const CERT_DIR = path.join(__dirname, '..', 'certs');
const keyPath = path.join(CERT_DIR, 'localhost-key.pem');
const certPath = path.join(CERT_DIR, 'localhost-cert.pem');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('HTTPS certs not found. Create server/certs/localhost-key.pem and server/certs/localhost-cert.pem');
  process.exit(1);
}

const httpsServer = https.createServer(
  {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  },
  app
);

const io = new Server(httpsServer, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log('[WS] connected:', socket.id);

  socket.on('todo:event', (payload) => {
    socket.broadcast.emit('todo:event', payload);
  });

  socket.on('disconnect', () => {
    console.log('[WS] disconnected:', socket.id);
  });
});

httpsServer.listen(PORT, () => {
  console.log(`\n✅ HTTPS server: https://localhost:${PORT}`);
  console.log(`📡 Health: https://localhost:${PORT}/api/health`);
  console.log(`🔔 Push: ${pushReady ? 'enabled' : 'disabled'}`);
  console.log(`📱 WebSocket: active\n`);
});