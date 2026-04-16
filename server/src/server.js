const fs = require('fs');
const path = require('path');
const https = require('https');

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { Server } = require('socket.io');
const { configureWebPush, sendNotification } = require('./push');

const app = express();
const PORT = Number(process.env.PORT || 3443);

app.use(cors());
app.use(express.json());

// --- Статика (фронтенд PWA) с подстановкой VAPID ключа ---
const FRONTEND_DIR = path.join(__dirname, '..', '..');

// Читаем index.html как шаблон для подстановки VAPID ключа
const indexPath = path.join(FRONTEND_DIR, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');

// Подставляем реальный VAPID публичный ключ из .env
if (process.env.VAPID_PUBLIC_KEY) {
  // Заменяем плейсхолдер в двух возможных форматах
  indexHtml = indexHtml.replace(
    /content="ВАШ_VAPID_PUBLIC_KEY"/g,
    `content="${process.env.VAPID_PUBLIC_KEY}"`
  );
  indexHtml = indexHtml.replace(
    /ВАШ_VAPID_PUBLIC_KEY/g,
    process.env.VAPID_PUBLIC_KEY
  );
  console.log('[SERVER] VAPID public key injected into index.html');
} else {
  console.warn('[SERVER] VAPID_PUBLIC_KEY not set, push notifications will not work');
}

// Отдаём модифицированный HTML для корневого маршрута
app.get('/', (req, res) => {
  res.send(indexHtml);
});

// Раздаём остальную статику (CSS, JS, изображения, иконки)
app.use(express.static(FRONTEND_DIR));

// API endpoints
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// --- Push: учебное хранилище подписок (в памяти процесса) ---
const subscriptions = new Set();

let pushReady = false;
try {
  configureWebPush({
    subject: process.env.VAPID_SUBJECT,
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
  });
  pushReady = true;
  console.log('[SERVER] Push notifications configured');
} catch (e) {
  console.warn('[PUSH] Not configured:', e.message);
}

// Сохранить push-подписку
app.post('/api/push/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription) {
    return res.status(400).json({ error: 'subscription_required' });
  }
  subscriptions.add(JSON.stringify(subscription));
  console.log('[PUSH] Subscription saved, total:', subscriptions.size);
  res.json({ ok: true, count: subscriptions.size, pushReady });
});

// Отправить тестовый push всем подписчикам
app.post('/api/push/test', async (req, res) => {
  if (!pushReady) {
    return res.status(400).json({ error: 'push_not_configured', message: 'Set VAPID keys in server/.env' });
  }

  const payload = JSON.stringify({
    title: '📋 Планировщик задач',
    body: 'Тестовое push-уведомление! Ваш список задач синхронизирован.',
    url: '/',
    ts: Date.now(),
  });

  let sent = 0;
  let failed = 0;
  
  for (const raw of Array.from(subscriptions)) {
    const subscription = JSON.parse(raw);
    try {
      await sendNotification(subscription, payload);
      sent++;
    } catch (e) {
      failed++;
      console.warn('[PUSH] Send failed:', e.statusCode || '', e.message);
      // Если подписка недействительна (410), удаляем её
      if (e.statusCode === 410) {
        subscriptions.delete(raw);
        console.log('[PUSH] Removed invalid subscription');
      }
    }
  }

  res.json({ ok: true, sent, failed, total: subscriptions.size });
});

// --- HTTPS server ---
const CERT_DIR = path.join(__dirname, '..', 'certs');
const keyPath = path.join(CERT_DIR, 'localhost-key.pem');
const certPath = path.join(CERT_DIR, 'localhost-cert.pem');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('HTTPS certs not found. Create server/certs/localhost-key.pem and server/certs/localhost-cert.pem');
  console.error('See server/README.md');
  process.exit(1);
}

const httpsServer = https.createServer(
  {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  },
  app
);

// --- Socket.IO (WebSocket) ---
const io = new Server(httpsServer, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  console.log('[WS] connected:', socket.id);

  socket.on('todo:event', (payload) => {
    console.log('[WS] todo:event from', socket.id, payload?.type);
    // Рассылаем всем остальным клиентам
    socket.broadcast.emit('todo:event', payload);
  });

  socket.on('disconnect', () => {
    console.log('[WS] disconnected:', socket.id);
  });
});

httpsServer.listen(PORT, () => {
  console.log(`\n✅ HTTPS server running: https://localhost:${PORT}`);
  console.log(`📡 Health check: https://localhost:${PORT}/api/health`);
  console.log(`🔔 Push API: ${pushReady ? 'enabled' : 'disabled (set VAPID keys in .env)'}`);
  console.log(`📱 WebSocket: active\n`);
});