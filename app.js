/**
 * Учебный TODO-менеджер для практик 13–16.
 * Объединённая версия: фильтрация, редактирование, подтверждение удаления,
 * App Shell, WebSocket синхронизация, Push уведомления.
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

// =========================================================
// Константы приложения
// =========================================================

const STORAGE_KEY = 'practice_13_14_todos_v2';
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
// Функции для WebSocket синхронизации (НОВОЕ)
// =========================================================

function initWebSocket() {
  if (socket && socket.connected) {
    console.log('[WS] Already connected');
    return;
  }

  socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  socket.on('connect', () => {
    console.log('[WS] Connected to server');
    isWebSocketConnected = true;
  });

  socket.on('disconnect', () => {
    console.log('[WS] Disconnected from server');
    isWebSocketConnected = false;
  });

  socket.on('todo:event', (payload) => {
    console.log('[WS] Received todo event:', payload);
    if (payload && payload.type) {
      switch (payload.type) {
        case 'add':
        case 'toggle':
        case 'delete':
        case 'edit':
        case 'clear_completed':
          renderTasks();
          break;
        default:
          renderTasks();
      }
    } else {
      renderTasks();
    }
  });

  socket.on('connect_error', (error) => {
    console.error('[WS] Connection error:', error);
    isWebSocketConnected = false;
  });
}

function emitTodoEvent(type, taskData = null) {
  if (!isWebSocketConnected) {
    console.log('[WS] Not connected, skipping emit');
    return;
  }
  
  const payload = {
    type: type,
    timestamp: Date.now(),
    data: taskData
  };
  socket.emit('todo:event', payload);
  console.log('[WS] Emitted todo event:', type);
}

// =========================================================
// Функции для Push уведомлений (НОВОЕ)
// =========================================================

const VAPID_PUBLIC_KEY_META = document.querySelector('meta[name="vapid-public-key"]');
const VAPID_PUBLIC_KEY = VAPID_PUBLIC_KEY_META ? VAPID_PUBLIC_KEY_META.getAttribute('content') : null;

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[PUSH] Push not supported');
    return null;
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  
  if (permission !== 'granted') {
    console.warn('[PUSH] Notification permission denied');
    return null;
  }

  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY === 'ВАШ_VAPID_PUBLIC_KEY') {
    console.warn('[PUSH] VAPID public key not configured');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey
      });
      console.log('[PUSH] New subscription created');
    } else {
      console.log('[PUSH] Existing subscription found');
    }

    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON())
    });
    
    if (response.ok) {
      console.log('[PUSH] Subscription saved on server');
      return subscription;
    }
  } catch (error) {
    console.error('[PUSH] Subscribe error:', error);
  }
  return null;
}

async function testPushNotification() {
  try {
    const response = await fetch('/api/push/test', { method: 'POST' });
    const data = await response.json();
    if (response.ok) {
      console.log('[PUSH] Test push sent:', data);
      alert(`Тестовое push-уведомление отправлено! (отправлено: ${data.sent} из ${data.total})`);
    } else {
      console.error('[PUSH] Test push failed:', data);
      alert(`Ошибка отправки push: ${data.message || 'Неизвестная ошибка'}`);
    }
  } catch (error) {
    console.error('[PUSH] Test push error:', error);
    alert('Не удалось отправить тестовое push-уведомление');
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// =========================================================
// Редактирование задачи (из вашей реализации)
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
// Создание DOM-элемента задачи (с кнопкой редактирования)
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
// Фильтрация (из вашей реализации)
// =========================================================

function getFilteredTasks(tasks) {
  switch (currentFilter) {
    case 'active':
      return tasks.filter(task => !task.completed);
    case 'completed':
      return tasks.filter(task => task.completed);
    case 'all':
    default:
      return tasks;
  }
}

function updateFilterButtons() {
  if (filterAllBtn) filterAllBtn.classList.remove('active');
  if (filterActiveBtn) filterActiveBtn.classList.remove('active');
  if (filterCompletedBtn) filterCompletedBtn.classList.remove('active');

  switch (currentFilter) {
    case 'all':
      if (filterAllBtn) filterAllBtn.classList.add('active');
      break;
    case 'active':
      if (filterActiveBtn) filterActiveBtn.classList.add('active');
      break;
    case 'completed':
      if (filterCompletedBtn) filterCompletedBtn.classList.add('active');
      break;
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
    if (task.id === taskId) {
      return { ...task, completed: !task.completed };
    }
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
// Установка PWA (из вашей реализации с улучшениями)
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
// Регистрация Service Worker (с уведомлением об обновлении)
// =========================================================

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service Worker не поддерживается в данном браузере.');
    return;
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      console.log('Service Worker зарегистрирован:', registration.scope);

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        console.log('Найдена новая версия Service Worker');
        
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('Доступно обновление приложения!');
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
// App Shell загрузка контента (НОВОЕ)
// =========================================================

const contentViewEl = document.getElementById('contentView');

async function loadPage(page) {
  const url = `/content/${page}.html`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (contentViewEl) contentViewEl.innerHTML = html;
    
    // Если загружена страница с push, добавляем обработчики
    if (page === 'push') {
      setTimeout(() => {
        const subscribeBtn = document.getElementById('subscribePushBtn');
        const testPushBtn = document.getElementById('testPushBtn');
        if (subscribeBtn) subscribeBtn.addEventListener('click', subscribeToPush);
        if (testPushBtn) testPushBtn.addEventListener('click', testPushNotification);
      }, 100);
    }
  } catch (e) {
    if (contentViewEl) {
      contentViewEl.innerHTML = `
        <section class="card" style="padding:16px; border:1px solid #e5e7eb; border-radius:14px; background:#fff;">
          <h2 style="margin:0 0 8px;">Нет доступа к контенту</h2>
          <p style="margin:0; color:#374151;">Не удалось загрузить <code>${url}</code>. Проверьте сеть/HTTPS и кеширование в Service Worker.</p>
        </section>
      `;
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

  if (action === 'delete') {
    deleteTask(taskId);
  }
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
    const page = btn.getAttribute('data-page');
    loadPage(page);
  });
});

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
}

init();