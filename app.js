/**
 * Учебный TODO-менеджер для практик 13–14.
 *
 * Что уже реализовано в шаблоне:
 * 1. Добавление, удаление и переключение статуса задач.
 * 2. Хранение задач в localStorage.
 * 3. Вывод статистики по задачам.
 * 4. Регистрация Service Worker.
 * 5. Поддержка установки PWA в Chromium-браузерах.
 * 6. Отдельная подсказка по установке в Safari.
 * 7. Случайные мотивационные цитаты в футере.
 *
 * Что оставлено студентам:
 * - редактирование задачи;
 * - фильтрация списка;
 * - подтверждение удаления;
 * - улучшение кэширования в Service Worker;
 * - более продуманная обработка обновлений PWA.
 */


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

/**
 * Ключ, под которым массив задач лежит в localStorage.
 * Если поменять ключ, приложение начнёт читать и сохранять данные
 * уже в другую запись хранилища.
 */
const STORAGE_KEY = 'practice_13_14_todos_v2';

/**
 * Массив цитат для нижнего блока.
 * Это небольшой пример клиентской динамики без обращения к серверу.
 */
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
let currentFilter = 'all'; // Возможные значения: 'all', 'active', 'completed'

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

/**
 * Сохраняет массив задач в localStorage.
 *
 * @param {Array} tasks - массив объектов задач.
 */
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

// Функция редактирования задачи
function editTask(taskId, newText) {
  const trimmedText = newText.trim();

  if (!trimmedText) {
    alert('Текст задачи не может быть пустым');
    return false;
  }

  const tasks = loadTasks();
  const updated = tasks.map(task => 
    task.id === taskId ? { ...task, text: trimmedText } : task
  );
  saveTasks(updated);
  renderTasks();
  return true;
}

/**
 * Формирует DOM-элемент для одной задачи.
 * Здесь выбран вариант именно с созданием DOM-узлов,
 * чтобы код был нагляднее и безопаснее для разбора.
 */
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
  editBtn.setAttribute('aria-label', 'Редактировать задачу');

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

/**
 * Перерисовывает блок статистики.
 */
function updateStats(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.completed).length;
  const active = total - completed;

  taskStats.textContent = `Всего: ${total} | Активных: ${active} | Выполненных: ${completed}`;
}

// Функция фильтра
function getFilteredTasks(tasks) {
  switch (currentFilter) {
    case 'active':
      return tasks.filter(task => !task.completed);
    case 'completed' :
      return tasks.filter(task => task.completed);
    case 'all' :
    default:
      return tasks;
  }
}

// Обновление активного класса кнопок фильтра
function updateFilterButtons() {
  // Убираем active класс у всех кнопок
  if (filterAllBtn) filterAllBtn.classList.remove('active');
  if (filterActiveBtn) filterActiveBtn.classList.remove('active');
  if (filterCompletedBtn) filterCompletedBtn.classList.remove('active');

   // Добавляем active класс текущей кнопке
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
  // Применяем фильтр
  const tasks = getFilteredTasks(allTasks);
  
  taskList.innerHTML = '';

  if (tasks.length === 0) {
    let emptyMessage = 'Пока задач нет. Добавьте первую запись.';
    
    // Разные сообщения для разных фильтров
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

/**
 * Добавляет новую задачу.
 *
 * @param {string} text - текст задачи.
 */
function addTask(text) {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return;
  }

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
}

/**
 * Переключает статус задачи по id.
 */
function toggleTask(taskId) {
  const updated = loadTasks().map((task) => {
    if (task.id === taskId) {
      return {
        ...task,
        completed: !task.completed
      };
    }

    return task;
  });

  saveTasks(updated);
  renderTasks();
}

/**
 * Удаляет задачу по id.
 * Добавлено подтверждение
 */
function deleteTask(taskId) {
  const task = loadTasks().find(t => t.id === taskId);

  if (!task) return;

  const confirmMessage = `Удалить задачу "${task.text.slice(0, 50)}${task.text.length > 50 ? '...' : ''}"?`;
  if (confirm(confirmMessage)) {
    const updated = loadTasks().filter((task) => task.id !== taskId);
    saveTasks(updated);
    renderTasks();
  }
}

/**
 * Удаляет все выполненные задачи. Добавлено подтверждение
 */
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
  }
}

// =========================================================
// Установка PWA
// =========================================================

/**
 * Определяет, запущено ли приложение уже в standalone-режиме.
 * Это полезно, чтобы не показывать кнопку установки там,
 * где приложение уже установлено и открыто как отдельное окно.
 */
function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/**
 * Обновляет текст подсказки по установке.
 * В Chromium мы можем показать собственную кнопку установки,
 * а в Safari остаётся сценарий через меню браузера.
 */
function updateInstallHint() {
  if (isStandaloneMode()) {
    installHint.textContent = 'Приложение уже запущено в standalone-режиме.';
    if (installBtn) {
      installBtn.hidden = true;
    }
    return;
  }

  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  if (isSafari) {
    installHint.textContent = 'Safari: для установки используйте File → Add to Dock.';
  } else {
    installHint.textContent = 'Chrome / Edge: установите приложение через кнопку браузера или кнопку «Установить PWA». ';
  }
}

function showInstallNotification() {
  // Не показываем, если уже standalone или уже показывали
  if (isStandaloneMode() || hasShownInstallNotification) {
    return;
  }
  
  // Не показываем в Safari (там нет программной установки)
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isSafari) {
    return;
  }
  
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
  
  // Анимация появления
  setTimeout(() => notification.classList.add('visible'), 10);
  
  // Кнопка установки
  document.getElementById('installNotifyBtn')?.addEventListener('click', () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(() => {
        notification.remove();
      });
    }
  });
  
  // Кнопка закрытия
  document.getElementById('closeNotifyBtn')?.addEventListener('click', () => {
    notification.classList.remove('visible');
    setTimeout(() => notification.remove(), 300);
  });
  
  // Автоматическое скрытие через 15 секунд
  setTimeout(() => {
    if (notification.parentNode) {
      notification.classList.remove('visible');
      setTimeout(() => notification.remove(), 300);
    }
  }, 15000);
}


/**
 * Событие beforeinstallprompt поддерживается в Chromium.
 * Здесь мы перехватываем стандартный prompt, сохраняем событие
 * и показываем свою кнопку установки в интерфейсе.
 */
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;

  if (installBtn && !isStandaloneMode()) {
    installBtn.hidden = false;
  }
  showInstallNotification();
});

/**
 * Нажатие на кнопку установки.
 */
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      return;
    }

    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    console.log('Результат установки PWA:', choiceResult.outcome);

    deferredInstallPrompt = null;
    installBtn.hidden = true;
  });
}

/**
 * Если приложение установлено, скрываем кнопку.
 */
window.addEventListener('appinstalled', () => {
  console.log('PWA успешно установлено.');
  deferredInstallPrompt = null;

  if (installBtn) {
    installBtn.hidden = true;
  }

  updateInstallHint();
});

// =========================================================
// Регистрация Service Worker
// =========================================================

/**
 * Регистрируем Service Worker только там, где технология поддерживается.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service Worker не поддерживается в данном браузере.');
    return;
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      console.log('Service Worker зарегистрирован:', registration.scope);

      /**
       * TODO для студентов:
       * 1. Добавить интерфейсное уведомление о том, что офлайн-режим готов.
       * 2. Обработать сценарий появления новой версии Service Worker.
       * 3. Показать пользователю кнопку "Обновить приложение".
       */

      console.log('Офлайн-режим готов к работе!');
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
// Обработчики событий
// =========================================================

/**
 * Отправка формы добавления задачи.
 */
taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addTask(taskInput.value);
  taskForm.reset();
  taskInput.focus();
});

// Делегирование кликов по списку задач с поддержкой редактирования
taskList.addEventListener('click', (event) => {
  const target = event.target;
  const taskItem = target.closest('.task-item');

  if (!taskItem) {
    return;
  }

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

/**
 * Отдельно обрабатываем изменение чекбокса.
 */
taskList.addEventListener('change', (event) => {
  const target = event.target;

  if (target.dataset.action !== 'toggle') {
    return;
  }

  const taskItem = target.closest('.task-item');
  if (!taskItem) {
    return;
  }

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
}

init();
