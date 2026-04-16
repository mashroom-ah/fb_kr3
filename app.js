/**
 * app.js (Практики 13-17)
 * 
 * Включает:
 * - TODO-список (добавление, удаление, редактирование, фильтрация)
 * - localStorage сохранение
 * - PWA установка
 * - WebSocket синхронизация
 * - Push уведомления (подписка, тестовая отправка)
 * - Отложенные напоминания (Практика 17)
 */

// =========================================================
// DOM-элементы интерфейса
// =========================================================

const taskForm = document.getElementById('taskForm');
const taskInput = document.getElementById('taskInput');
const taskList = document.getElementById('taskList');
const taskStats = document.getElementById('taskStats');
const clearCompletedBtn = document.getElementById('clearCompletedBtn');
const networkStatus = document.getElementById('networkStatus');
const installBtn = document.getElementById('installBtn');
const installHint = document.getElementById('installHint');
const quoteText = document.getElementById('quoteText');
const newQuoteBtn = document.getElementById('newQuoteBtn');
const filterAllBtn = document.getElementById('filterAll');
const filterActiveBtn = document.getElementById('filterActive');
const filterCompletedBtn = document.getElementById('filterCompleted');
const logEl = document.getElementById('log');

// =========================================================
// Константы приложения
// =========================================================

const STORAGE_KEY = 'practice_13_17_todos_v2';
const planningQuotes = [
  'Хороший план сегодня лучше идеального плана завтра.',
  'Планирование экономит время, которое иначе уходит на исправление хаоса.',
  'Большая цель достигается через маленькие запланированные шаги.',
  'Порядок в делах начинается с ясности следующего шага.',
  'Последовательность важнее разового вдохновения.',
  'План — это не ограничение, а инструмент управления неопределённостью.',
  'Когда задача записана, она перестаёт шуметь в голове.',
  'Хорошая система побеждает временный порыв.'
];

let deferredInstallPrompt = null;
let hasShownInstallNotification = false;
let currentFilter = 'all';
let socket = null;
let isWebSocketConnected = false;

// =========================================================
// Логирование
// =========================================================

function log(msg) {
  if (logEl) {
    logEl.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n${logEl.textContent}`;
  }
  console.log(msg);
}

// =========================================================
// Работа с localStorage
// =========================================================

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Не удалось прочитать задачи из localStorage:', error);
    return [];
  }
}

function saveTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// =========================================================
// Вспомогательные функции
// =========================================================

function generateId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function updateNetworkStatus() {
  const isOnline = navigator.onLine;
  networkStatus.textContent = isOnline ? 'Онлайн' : 'Офлайн';
  networkStatus.classList.toggle('badge--success', isOnline);
  networkStatus.classList.toggle('badge--offline', !isOnline);
}

function showRandomQuote() {
  const randomIndex = Math.floor(Math.random() * planningQuotes.length);
  quoteText.textContent = planningQuotes[randomIndex];
}

// =========================================================
// WebSocket синхронизация
// =========================================================

function initWebSocket() {
  if (socket && socket.connected) return;

  socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  socket.on('connect', () => {
    log('WebSocket подключён');
    isWebSocketConnected = true;
  });

  socket.on('disconnect', () => {
    log('WebSocket отключён');
    isWebSocketConnected = false;
  });

  socket.on('todo:event', (payload) => {
    log(`Получено событие: ${payload?.type}`);
    renderTasks();
  });

  socket.on('connect_error', (error) => {
    console.error('WebSocket error:', error);
    isWebSocketConnected = false;
  });
}

function emitTodoEvent(type, taskData = null) {
  if (!isWebSocketConnected) return;
  socket.emit('todo:event', { type, timestamp: Date.now(), data: taskData });
}

// =========================================================
// Редактирование задачи
// =========================================================

function editTask(taskId, newText) {
  const trimmedText = newText.trim();
  if (!trimmedText) {
    alert('Текст задачи не может быть пустым');
    return false;
  }

  const tasks = loadTasks();
  const oldTask = tasks.find(t => t.id === taskId);
  const updated = tasks.map(task => 
    task.id === taskId ? { ...task, text: trimmedText } : task
  );
  saveTasks(updated);
  renderTasks();
  emitTodoEvent('edit', { id: taskId, oldText: oldTask?.text, newText: trimmedText });
  return true;
}

// =========================================================
// Создание DOM-элемента задачи
// =========================================================

function createTaskElement(task) {
  const li = document.createElement('li');
  li.className = 'task-item';
  li.dataset.id = task.id;

  const leftPart = document.createElement('div');
  leftPart.className = 'task-item__left';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.dataset.action = 'toggle';
  checkbox.setAttribute('aria-label', 'Отметить задачу выполненной');

  const text = document.createElement('span');
  text.className = 'task-item__text';
  text.textContent = task.text;

  if (task.completed) {
    text.classList.add('task-item__text--completed');
  }

  leftPart.appendChild(checkbox);
  leftPart.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'task-item__actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'button button--secondary button--small';
  editBtn.textContent = 'Редактировать';
  editBtn.dataset.action = 'edit';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'button button--danger button--small';
  deleteBtn.textContent = 'Удалить';
  deleteBtn.dataset.action = 'delete';

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  li.appendChild(leftPart);
  li.appendChild(actions);

  return li;
}

function updateStats(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.completed).length;
  const active = total - completed;
  taskStats.textContent = `Всего: ${total} | Активных: ${active} | Выполненных: ${completed}`;
}

// =========================================================
// Фильтрация
// =========================================================

function getFilteredTasks(tasks) {
  switch (currentFilter) {
    case 'active': return tasks.filter(task => !task.completed);
    case 'completed': return tasks.filter(task => task.completed);
    default: return tasks;
  }
}

function updateFilterButtons() {
  if (filterAllBtn) filterAllBtn.classList.remove('active');
  if (filterActiveBtn) filterActiveBtn.classList.remove('active');
  if (filterCompletedBtn) filterCompletedBtn.classList.remove('active');

  switch (currentFilter) {
    case 'all': if (filterAllBtn) filterAllBtn.classList.add('active'); break;
    case 'active': if (filterActiveBtn) filterActiveBtn.classList.add('active'); break;
    case 'completed': if (filterCompletedBtn) filterCompletedBtn.classList.add('active'); break;
  }
}

function renderTasks() {
  const allTasks = loadTasks();
  const tasks = getFilteredTasks(allTasks);
  
  taskList.innerHTML = '';

  if (tasks.length === 0) {
    let emptyMessage = 'Пока задач нет. Добавьте первую запись.';
    if (currentFilter === 'active' && allTasks.length > 0) {
      emptyMessage = 'Нет активных задач. Отличная работа!';
    } else if (currentFilter === 'completed' && allTasks.length > 0) {
      emptyMessage = 'Нет выполненных задач. Вперёд к новым свершениям!';
    }
    
    const emptyState = document.createElement('li');
    emptyState.className = 'empty-state';
    emptyState.textContent = emptyMessage;
    taskList.appendChild(emptyState);
    updateStats(allTasks);
    return;
  }

  tasks.forEach((task) => {
    taskList.appendChild(createTaskElement(task));
  });
  updateStats(allTasks);
}

// =========================================================
// Бизнес-логика TODO-списка
// =========================================================

function addTask(text) {
  const normalizedText = text.trim();
  if (!normalizedText) return;

  const tasks = loadTasks();
  const newTask = {
    id: generateId(),
    text: normalizedText,
    completed: false,
    createdAt: new Date().toISOString()
  };

  tasks.unshift(newTask);
  saveTasks(tasks);
  renderTasks();
  emitTodoEvent('add', newTask);
}

function toggleTask(taskId) {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === taskId);
  const updated = tasks.map((task) => {
    if (task.id === taskId) return { ...task, completed: !task.completed };
    return task;
  });
  saveTasks(updated);
  renderTasks();
  emitTodoEvent('toggle', { id: taskId, completed: !task?.completed });
}

function deleteTask(taskId) {
  const task = loadTasks().find(t => t.id === taskId);
  if (!task) return;

  const confirmMessage = `Удалить задачу "${task.text.slice(0, 50)}${task.text.length > 50 ? '...' : ''}"?`;
  if (confirm(confirmMessage)) {
    const updated = loadTasks().filter((task) => task.id !== taskId);
    saveTasks(updated);
    renderTasks();
    emitTodoEvent('delete', { id: taskId });
  }
}

function clearCompletedTasks() {
  const tasks = loadTasks();
  const completedTasks = tasks.filter((task) => task.completed);
  const completedCount = completedTasks.length;
  
  if (completedCount === 0) {
    alert('Нет выполненных задач для удаления!');
    return;
  }
  
  const confirmMessage = completedCount === 1 
    ? 'Удалить 1 выполненную задачу?' 
    : `Удалить ${completedCount} выполненных задач?`;
  
  if (confirm(confirmMessage)) {
    const updated = tasks.filter((task) => !task.completed);
    saveTasks(updated);
    renderTasks();
    emitTodoEvent('clear_completed', { count: completedCount });
  }
}

// =========================================================
// Установка PWA
// =========================================================

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function updateInstallHint() {
  if (isStandaloneMode()) {
    installHint.textContent = 'Приложение уже запущено в standalone-режиме.';
    if (installBtn) installBtn.hidden = true;
    return;
  }
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isSafari) {
    installHint.textContent = 'Safari: для установки используйте File → Add to Dock.';
  } else {
    installHint.textContent = 'Chrome / Edge: установите приложение через кнопку браузера или кнопку «Установить PWA».';
  }
}

function showInstallNotification() {
  if (isStandaloneMode() || hasShownInstallNotification) return;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isSafari) return;
  
  hasShownInstallNotification = true;
  const notification = document.createElement('div');
  notification.className = 'install-notification';
  notification.innerHTML = `
    <div class="install-notification__icon">📱</div>
    <div class="install-notification__content">
      <div class="install-notification__title">Установите приложение!</div>
      <div class="install-notification__text">Работайте офлайн, открывайте одним нажатием</div>
    </div>
    <div class="install-notification__buttons">
      <button id="installNotifyBtn" class="button button--small button--primary">Установить</button>
      <button id="closeNotifyBtn" class="button button--small button--ghost">✕</button>
    </div>
  `;
  document.body.appendChild(notification);
  setTimeout(() => notification.classList.add('visible'), 10);
  
  document.getElementById('installNotifyBtn')?.addEventListener('click', () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(() => notification.remove());
    }
  });
  document.getElementById('closeNotifyBtn')?.addEventListener('click', () => {
    notification.classList.remove('visible');
    setTimeout(() => notification.remove(), 300);
  });
  setTimeout(() => {
    if (notification.parentNode) {
      notification.classList.remove('visible');
      setTimeout(() => notification.remove(), 300);
    }
  }, 15000);
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installBtn && !isStandaloneMode()) installBtn.hidden = false;
  showInstallNotification();
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    console.log('Результат установки PWA:', choiceResult.outcome);
    deferredInstallPrompt = null;
    installBtn.hidden = true;
  });
}

window.addEventListener('appinstalled', () => {
  console.log('PWA успешно установлено.');
  deferredInstallPrompt = null;
  if (installBtn) installBtn.hidden = true;
  updateInstallHint();
});

// =========================================================
// Service Worker регистрация
// =========================================================

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service Worker не поддерживается');
    return;
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      log('Service Worker зарегистрирован');

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            log('Доступна новая версия приложения!');
            const updateNotification = document.createElement('div');
            updateNotification.className = 'update-notification';
            updateNotification.innerHTML = `
              <span>Доступна новая версия!</span>
              <button id="refreshAppBtn" class="button button--small button--primary">Обновить</button>
            `;
            document.body.appendChild(updateNotification);
            document.getElementById('refreshAppBtn')?.addEventListener('click', () => {
              newWorker.postMessage({ action: 'skipWaiting' });
              window.location.reload();
            });
            setTimeout(() => updateNotification.remove(), 10000);
          }
        });
      });
    } catch (error) {
      console.error('Ошибка регистрации Service Worker:', error);
    }
  });
}

// =========================================================
// PUSH УВЕДОМЛЕНИЯ (Практика 16-17)
// =========================================================

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    log('Push не поддерживается в этом браузере');
    return null;
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  
  if (permission !== 'granted') {
    log('Разрешение на уведомления не получено');
    return null;
  }

  try {
    const response = await fetch('/api/push/vapid-public-key');
    const { publicKey } = await response.json();
    if (!publicKey) throw new Error('VAPID public key not configured');

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });
      log('Новая push-подписка создана');
    } else {
      log('Используем существующую push-подписку');
    }

    const subscribeRes = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON())
    });
    const result = await subscribeRes.json();
    log(`Подписка сохранена на сервере. Всего подписок: ${result.count}`);
    return subscription;
  } catch (error) {
    log(`Ошибка подписки: ${error.message}`);
    return null;
  }
}

async function testPush() {
  try {
    const response = await fetch('/api/push/test', { method: 'POST' });
    const result = await response.json();
    if (result.error) {
      log(`Ошибка: ${result.message}`);
    } else {
      log(`Тестовый push отправлен: ${result.sent} из ${result.total}`);
    }
  } catch (error) {
    log(`Ошибка отправки: ${error.message}`);
  }
}

async function scheduleReminder() {
  const title = document.getElementById('rem-title')?.value.trim() || 'Напоминание';
  const delaySeconds = Number(document.getElementById('rem-delay')?.value || 30);

  if (delaySeconds < 1) {
    alert('Задержка должна быть больше 0 секунд');
    return;
  }

  try {
    const response = await fetch('/api/reminders/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body: 'Отложенное уведомление (ПР17)', delaySeconds })
    });
    const result = await response.json();
    
    if (result.error) {
      log(`Ошибка планирования: ${result.message}`);
      alert(`Ошибка: ${result.message}`);
    } else {
      log(`Напоминание запланировано: id=${result.reminder.id}, через ${delaySeconds} сек`);
      alert(`✅ Напоминание запланировано!\nОтправится через ${delaySeconds} сек.`);
    }
  } catch (error) {
    log(`Ошибка: ${error.message}`);
    alert('Ошибка при планировании напоминания');
  }
}

// =========================================================
// App Shell загрузка контента
// =========================================================

const contentViewEl = document.getElementById('contentView');

async function loadPage(page) {
  const url = `/content/${page}.html`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (contentViewEl) contentViewEl.innerHTML = html;
  } catch (e) {
    if (contentViewEl) {
      contentViewEl.innerHTML = `<section class="card"><p>Не удалось загрузить ${url}</p></section>`;
    }
  }
}

// =========================================================
// Обработчики событий
// =========================================================

taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addTask(taskInput.value);
  taskForm.reset();
  taskInput.focus();
});

taskList.addEventListener('click', (event) => {
  const target = event.target;
  const taskItem = target.closest('.task-item');
  if (!taskItem) return;

  const taskId = taskItem.dataset.id;
  const action = target.dataset.action;

  if (action === 'delete') deleteTask(taskId);
  if (action === 'edit') {
    const tasks = loadTasks();
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      const newText = prompt('Редактирование задачи:', task.text);
      if (newText !== null && newText.trim() !== '') {
        editTask(taskId, newText);
      } else if (newText !== null && newText.trim() === '') {
        alert('Текст задачи не может быть пустым!');
      }
    }
  }
});

taskList.addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset.action !== 'toggle') return;
  const taskItem = target.closest('.task-item');
  if (!taskItem) return;
  toggleTask(taskItem.dataset.id);
});

clearCompletedBtn.addEventListener('click', clearCompletedTasks);
newQuoteBtn.addEventListener('click', showRandomQuote);
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

if (filterAllBtn) {
  filterAllBtn.addEventListener('click', () => {
    currentFilter = 'all';
    updateFilterButtons();
    renderTasks();
  });
}
if (filterActiveBtn) {
  filterActiveBtn.addEventListener('click', () => {
    currentFilter = 'active';
    updateFilterButtons();
    renderTasks();
  });
}
if (filterCompletedBtn) {
  filterCompletedBtn.addEventListener('click', () => {
    currentFilter = 'completed';
    updateFilterButtons();
    renderTasks();
  });
}

document.querySelectorAll('button[data-page]').forEach((btn) => {
  btn.addEventListener('click', () => {
    loadPage(btn.getAttribute('data-page'));
  });
});

// Кнопки Push
const subscribeBtn = document.getElementById('btn-subscribe');
const testPushBtn = document.getElementById('btn-push-test');
const scheduleBtn = document.getElementById('btn-schedule');

if (subscribeBtn) subscribeBtn.addEventListener('click', subscribeToPush);
if (testPushBtn) testPushBtn.addEventListener('click', testPush);
if (scheduleBtn) scheduleBtn.addEventListener('click', scheduleReminder);

// =========================================================
// Инициализация
// =========================================================

function init() {
  updateNetworkStatus();
  updateInstallHint();
  showRandomQuote();
  renderTasks();
  registerServiceWorker();
  updateFilterButtons();
  initWebSocket();
  loadPage('home');
  log('Приложение инициализировано');
}

init();