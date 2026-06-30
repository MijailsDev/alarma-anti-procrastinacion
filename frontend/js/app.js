import CONFIG from './config.js';
import { formatRelativeDate } from './formatDate.js';

let audioCtx = null;
let alarmIntervalId = null;
let isSilenced = false;
let silenceTimeoutId = null;
let monitorIntervalId = null;

let notificationsEnabled = false;

const NOTIFIED_KEY = 'notified_tasks';
const NOTIF_ENABLED_KEY = 'notif_enabled';

function getNotifiedTasks() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY)) || [];
  } catch {
    return [];
  }
}

function saveNotifiedTasks(list) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(list));
}

function isTaskNotified(taskId) {
  return getNotifiedTasks().some(entry => entry.taskId === taskId);
}

function markTaskAsNotified(taskId) {
  const list = getNotifiedTasks();
  if (!list.some(entry => entry.taskId === taskId)) {
    list.push({ taskId, date: Date.now() });
    saveNotifiedTasks(list);
  }
}

function cleanupNotifiedTasks() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const list = getNotifiedTasks().filter(entry => entry.date >= todayMs);
  saveNotifiedTasks(list);
}

function startNotificationMonitor() {
  stopNotificationMonitor();
  monitorIntervalId = setInterval(() => fetchTasks(), 60000);
}

function stopNotificationMonitor() {
  if (monitorIntervalId) {
    clearInterval(monitorIntervalId);
    monitorIntervalId = null;
  }
}

/* ---- LUCIDE ICON HELPER ---- */
function icon(name, extra = '') {
  return `<i data-lucide="${name}" class="icon-inline ${extra}"></i>`;
}

function renderIcons() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

/* ---- SKELETON LOADERS ---- */
function showSkeleton(container) {
  container.innerHTML = `
    <div class="skeleton-card" aria-hidden="true">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="skeleton-title"></div>
        <div class="skeleton-badge"></div>
      </div>
      <div class="skeleton-line long"></div>
      <div class="skeleton-dates">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
      <div class="skeleton-line block"></div>
      <div class="skeleton-line block" style="width:60%"></div>
    </div>
    <div class="skeleton-card" aria-hidden="true">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="skeleton-title"></div>
        <div class="skeleton-badge"></div>
      </div>
      <div class="skeleton-line long"></div>
      <div class="skeleton-dates">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
      <div class="skeleton-line block"></div>
      <div class="skeleton-line block" style="width:60%"></div>
    </div>
  `;
}

/* ---- BUTTON LOADING STATE ---- */
function setLoading(btn, isLoading) {
  if (isLoading) {
    btn.classList.add('btn-loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

/* ---- TOKEN / AUTH HELPERS ---- */

let isRefreshing = false;
let refreshPromise = null;

function getToken() {
  return localStorage.getItem('jwt_token');
}

function setToken(token) {
  localStorage.setItem('jwt_token', token);
}

function getRefreshToken() {
  return localStorage.getItem('jwt_refresh_token');
}

function setRefreshToken(token) {
  localStorage.setItem('jwt_refresh_token', token);
}

function clearToken() {
  localStorage.removeItem('jwt_token');
  localStorage.removeItem('jwt_refresh_token');
  localStorage.removeItem('jwt_user');
}

function getAuthHeaders() {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${CONFIG.API_BASE}/refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (!res.ok) return null;

    const data = await res.json();
    setToken(data.token);
    setRefreshToken(data.refreshToken);
    return data.token;
  } catch {
    return null;
  }
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...getAuthHeaders(), ...options.headers }
  });

  if (res.status === 401) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = refreshAccessToken().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }

    const newToken = await refreshPromise;

    if (!newToken) {
      clearToken();
      showAuth();
      showToast('Sesión expirada. Inicia sesión nuevamente.', 'error');
      return null;
    }

    const retryRes = await fetch(url, {
      ...options,
      headers: { ...getAuthHeaders(), ...options.headers }
    });
    return retryRes;
  }

  return res;
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('jwt_user'));
  } catch {
    return null;
  }
}

function setStoredUser(user) {
  localStorage.setItem('jwt_user', JSON.stringify(user));
}

function showApp(username) {
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'block';
  if (username) {
    document.getElementById('user-badge').innerHTML = `${icon('user')}${escapeHTML(username)}`;
    renderIcons();
  }
}

function showAuth() {
  document.getElementById('auth-container').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';
  stopAudioAlarmLoop();
  stopNotificationMonitor();
  document.getElementById('global-panic-bar').classList.remove('panic-active');
  document.getElementById('global-panic-bar').classList.add('panic-hidden');
}

function switchAuthForm(formId) {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(formId).classList.add('active');
  document.querySelector(`.auth-tab[data-form="${formId}"]`).classList.add('active');
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';
}

/* ---- ENDPOINTS DE AUTENTICACIÓN ---- */

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  if (!username || !password) {
    errorEl.textContent = 'Completa todos los campos.';
    return;
  }

  try {
    const res = await fetch(`${CONFIG.API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Error al iniciar sesión.';
      return;
    }

    setToken(data.token);
    if (data.refreshToken) setRefreshToken(data.refreshToken);
    setStoredUser(data.user);
    showApp(data.user.username);
    document.getElementById('login-form').reset();
    loadApp();
  } catch (err) {
    errorEl.textContent = 'Error de conexión con el servidor.';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value.trim();
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';

  if (!username || !password) {
    errorEl.textContent = 'Completa todos los campos.';
    return;
  }

  if (password.length < 6) {
    errorEl.textContent = 'La contraseña debe tener al menos 6 caracteres.';
    return;
  }

  try {
    const res = await fetch(`${CONFIG.API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Error al registrarse.';
      return;
    }

    setToken(data.token);
    if (data.refreshToken) setRefreshToken(data.refreshToken);
    setStoredUser(data.user);
    showApp(data.user.username);
    document.getElementById('register-form').reset();
    loadApp();
  } catch (err) {
    errorEl.textContent = 'Error de conexión con el servidor.';
  }
}

function handleLogout() {
  clearToken();
  showAuth();
  stopAudioAlarmLoop();
}

/* ---- SISTEMA DE AUDIO ---- */

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playBeep(frequency = 880, duration = 0.15) {
  if (!audioCtx) return;

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function startAudioAlarmLoop(nivel) {
  stopAudioAlarmLoop();
  if (isSilenced) return;

  let intervalMs = 0;
  let freq = 880;

  if (nivel === '¡MÁXIMO PELIGRO (CRÍTICO)!') {
    intervalMs = 800;
    freq = 1100;
  } else if (nivel === 'Alto (Crítico)') {
    intervalMs = 2500;
    freq = 880;
  } else if (nivel === 'Moderado') {
    intervalMs = 10000;
    freq = 660;
  }

  if (intervalMs > 0) {
    playBeep(freq, 0.2);
    alarmIntervalId = setInterval(() => {
      playBeep(freq, 0.2);
    }, intervalMs);
  }
}

function stopAudioAlarmLoop() {
  if (alarmIntervalId) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
}

/* ---- THEME TOGGLE ---- */

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  const toggle = document.getElementById('theme-toggle');
  toggle.innerHTML = isLight ? icon('sun', 'icon-only') : icon('moon', 'icon-only');
  renderIcons();
}

function applySavedTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.innerHTML = icon('sun', 'icon-only');
    renderIcons();
  }
}

/* ---- HIGH CONTRAST TOGGLE ---- */

function toggleContrast() {
  const isHigh = document.body.classList.toggle('high-contrast');
  localStorage.setItem('highContrast', isHigh ? 'true' : '');
  const btn = document.getElementById('contrast-toggle');
  if (btn) btn.innerHTML = isHigh ? icon('contrast', 'icon-only') + icon('check', 'icon-only') : icon('contrast', 'icon-only');
  renderIcons();
}

function applySavedContrast() {
  if (localStorage.getItem('highContrast')) {
    document.body.classList.add('high-contrast');
    const btn = document.getElementById('contrast-toggle');
    if (btn) btn.innerHTML = icon('contrast', 'icon-only') + icon('check', 'icon-only');
    renderIcons();
  }
}

/* ---- INICIALIZACIÓN DE EVENTOS (una sola vez) ---- */

function initAppEvents() {
  document.getElementById('refresh-tasks').addEventListener('click', fetchTasks);
  document.getElementById('task-form').addEventListener('submit', createTask);
  document.getElementById('save-margin-btn').addEventListener('click', updateMarginHours);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('contrast-toggle').addEventListener('click', toggleContrast);
  document.getElementById('notif-permit-btn').addEventListener('click', requestNotificationPermission);
  document.getElementById('silence-btn').addEventListener('click', silenceHandler);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('register-form').addEventListener('submit', handleRegister);

  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => switchAuthForm(tab.dataset.form));
  });

  document.body.addEventListener('click', () => { initAudio(); }, { once: true });

  startCountdown();

  // Pausar countdowns cuando la pestaña está oculta
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopCountdown();
    } else {
      startCountdown();
    }
  });
}

function silenceNotification() {
  initAudio();
  isSilenced = true;
  stopAudioAlarmLoop();
  document.getElementById('global-panic-bar').classList.remove('panic-active');
  document.getElementById('global-panic-bar').classList.add('panic-hidden');

  if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
  silenceTimeoutId = setTimeout(() => {
    isSilenced = false;
    fetchTasks();
  }, 600000);
}

function silenceHandler() {
  initAudio();
  isSilenced = true;
  stopAudioAlarmLoop();
  document.getElementById('global-panic-bar').classList.remove('panic-active');
  document.getElementById('global-panic-bar').classList.add('panic-hidden');

  if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
  silenceTimeoutId = setTimeout(() => {
    isSilenced = false;
    fetchTasks();
  }, 180000);
}

function loadApp() {
  cleanupNotifiedTasks();
  fetchTasks();
  fetchConfig();
  initAnalytics();
  startNotificationMonitor();
}

function setupSWMessageListener() {
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    const { type, action, tareaId } = e.data;
    if (type !== 'notification-action') return;
    if (action === 'complete') {
      window.updateTaskStatus(tareaId, 'Enviada');
    } else if (action === 'snooze') {
      silenceNotification();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applySavedTheme();
  applySavedContrast();
  initAppEvents();
  registerServiceWorker();
  setupSWMessageListener();
  restoreNotifState();
  renderIcons();

  const token = getToken();
  const user = getStoredUser();

  if (token && user) {
    showApp(user.username);
    loadApp();
  } else {
    showAuth();
  }
});

function startCountdown() {
  if (countdownIntervalId) return;
  let lastUpdate = 0;
  function tick(now) {
    if (now - lastUpdate >= 1000) {
      lastUpdate = now;
      updateAllCountdowns();
    }
    countdownIntervalId = requestAnimationFrame(tick);
  }
  updateAllCountdowns();
  lastUpdate = performance.now();
  countdownIntervalId = requestAnimationFrame(tick);
}

function stopCountdown() {
  if (countdownIntervalId) {
    cancelAnimationFrame(countdownIntervalId);
    countdownIntervalId = null;
  }
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registrado:', reg.scope);
    } catch (err) {
      console.warn('Service Worker no disponible:', err.message);
    }
  }
}

/* ---- CRUD DE TAREAS ---- */

async function fetchTasks() {
  const container = document.getElementById('tasks-list');
  showSkeleton(container);

  try {
    const res = await apiFetch(`${CONFIG.API_BASE}/tareas`);
    if (!res) return;

    const tareas = await res.json();
    renderTasks(tareas);
    renderIcons();
    evaluateGlobalAlarms(tareas);
    updateAllCountdowns();
  } catch (err) {
    console.error('fetchTasks error:', err);
    container.innerHTML = `
      <div class="empty-state">
        <p style="color: #ef4444;">No se pudo conectar con el servidor Express backend.</p>
        <p style="font-size: 0.85rem; margin-top: 10px;">Asegúrate de que 'docker-compose up' esté corriendo correctamente.</p>
      </div>
    `;
  }
}

let lastTareasData = null;

function renderTasks(tareas) {
  const container = document.getElementById('tasks-list');
  const historyCount = document.getElementById('history-count');
  const historyDetails = document.querySelector('.history-details');

  const activas = tareas.filter(t => t.estado !== 'Enviada');
  const completadas = tareas.filter(t => t.estado === 'Enviada');

  lastTareasData = tareas;
  historyCount.textContent = completadas.length;

  if (activas.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Excelente! No tienes tareas pendientes actualmente.</p>
        <p style="font-size: 0.85rem; margin-top: 10px;">Anade una nueva tarea a la izquierda para activar el escudo anti-procrastinacion.</p>
      </div>
    `;
  } else {
    container.innerHTML = activas.map(tarea => renderActiveCard(tarea)).join('');
  }

  // Lazy render historial solo cuando se abre
  if (!historyDetails._lazyInit) {
    historyDetails._lazyInit = true;
    historyDetails.addEventListener('toggle', () => {
      if (historyDetails.open && lastTareasData) {
        renderHistory(lastTareasData);
      }
    });
  }

  // Si ya esta abierto, renderizar ahora
  if (historyDetails.open) {
    renderHistory(tareas);
  }
}

function renderHistory(tareas) {
  const historyContainer = document.getElementById('history-list');
  const completadas = tareas.filter(t => t.estado === 'Enviada');

  if (completadas.length === 0) {
    historyContainer.innerHTML = `<div class="empty-state"><p>Aun no hay tareas completadas.</p></div>`;
  } else {
    historyContainer.innerHTML = completadas.map(tarea => renderCompletedCard(tarea)).join('');
  }
  renderIcons();
}

let countdownIntervalId = null;
let toastTimeoutId = null;

function showToast(message, type = 'info', duration = 3500) {
  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
  }

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  toastTimeoutId = setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    toastTimeoutId = null;
  }, duration);
}

const ALERT_LABELS = {
  'Bajo': 'Estado: Óptimo',
  'Moderado': 'Atención Requerida',
  'Alto (Crítico)': 'Prioridad Máxima',
  '¡MÁXIMO PELIGRO (CRÍTICO)!': 'FFL Vencida &mdash; Acción Inmediata'
};

function renderActiveCard(tarea) {
  let borderClass = 'border-safe';
  let alarmClass = 'alarm-safe';

  if (tarea.alarma.nivel === '¡MÁXIMO PELIGRO (CRÍTICO)!') {
    borderClass = 'border-panic';
    alarmClass = 'alarm-panic';
  } else if (tarea.alarma.nivel === 'Alto (Crítico)') {
    borderClass = 'border-danger';
    alarmClass = 'alarm-danger';
  } else if (tarea.alarma.nivel === 'Moderado') {
    borderClass = 'border-warning';
    alarmClass = 'alarm-warning';
  }

  const fReal = new Date(tarea.fecha_limite_real).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });

  let actionButtons = '';
  if (tarea.estado === 'Pendiente') {
    actionButtons = `
      <button class="btn-action btn-start" onclick="updateTaskStatus(${tarea.id}, 'En Progreso')">
        ${icon('zap')}Empezar Trabajo (Pendiente → En Progreso)
      </button>
    `;
  } else if (tarea.estado === 'En Progreso') {
    actionButtons = `
      <button class="btn-action btn-submit-task" onclick="updateTaskStatus(${tarea.id}, 'En Enviada')">
        ${icon('upload')}Marcar como Entregado
      </button>
    `;
  }

  const alertLabel = ALERT_LABELS[tarea.alarma.nivel] || tarea.alarma.nivel;

  return `
    <div class="task-card ${borderClass}">
      <div class="task-header">
        <h3 class="task-title">${escapeHTML(tarea.titulo)}</h3>
        <div class="task-header-right">
          <span class="task-status ${tarea.estado.toLowerCase().replace(' ', '-')}">${tarea.estado}</span>
          <button class="btn-delete" onclick="deleteTask(${tarea.id})" title="Eliminar tarea">${icon('trash-2', 'icon-only')}</button>
        </div>
      </div>
      <p class="task-desc">${escapeHTML(tarea.descripcion || 'Sin descripción.')}</p>
      <div class="task-dates info-panel">
        <div class="date-block">
          <strong>FFL</strong>
          <span class="ffl-primary">${formatRelativeDate(tarea.fecha_limite_falsa)}</span>
          <span class="real-trigger" tabindex="0" role="button" aria-label="Ver límite oficial">
            ${icon('info')}
            <span class="real-tooltip">
            <span class="real-tooltip-label">Límite Oficial</span>
            <span class="real-tooltip-date">${fReal}</span>
          </span>
          </span>
        </div>
      </div>
      <div id="countdown-${tarea.id}" class="task-countdown info-panel" data-ffl="${tarea.fecha_limite_falsa}">
        <span class="countdown-icon">${renderCountdownIcon(tarea.id, tarea.fecha_limite_falsa)}</span>
        <span class="countdown-text">${renderCountdownText(tarea.fecha_limite_falsa)}</span>
      </div>
      <div class="task-alarm-info info-panel ${alarmClass}">
        <span>${alertLabel}</span>
      </div>
      <div class="task-actions">
        ${actionButtons}
      </div>
    </div>
  `;
}

function formatCountdown(fechaLimiteFalsa) {
  const ffl = new Date(fechaLimiteFalsa);
  const ahora = new Date();
  const diffMs = ffl - ahora;
  const absMs = Math.abs(diffMs);
  const totalMinutos = Math.floor(absMs / 60000);
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  const dias = Math.floor(horas / 24);
  const horasResto = horas % 24;

  if (diffMs > 0) {
    if (dias > 0) {
      return `${dias}d ${String(horasResto).padStart(2, '0')}h ${String(minutos).padStart(2, '0')}m`;
    }
    return `${String(horas).padStart(2, '0')}h ${String(minutos).padStart(2, '0')}m`;
  }

  return `${String(horas).padStart(2, '0')}h ${String(minutos).padStart(2, '0')}m`;
}

function renderCountdownIcon(id, fechaLimiteFalsa) {
  const ffl = new Date(fechaLimiteFalsa);
  const ahora = new Date();
  return ffl > ahora ? icon('hourglass') : icon('alert-triangle');
}

function renderCountdownText(fechaLimiteFalsa) {
  const ffl = new Date(fechaLimiteFalsa);
  const ahora = new Date();
  const diffMs = ffl - ahora;

  if (diffMs > 0) {
    return `Faltan ${formatCountdown(fechaLimiteFalsa)}`;
  }
  return `Vencida ${formatCountdown(fechaLimiteFalsa)}`;
}

function updateAllCountdowns() {
  try {
    document.querySelectorAll('[id^="countdown-"]').forEach(el => {
      const ffl = el.dataset.ffl;
      if (!ffl) return;
      const iconSpan = el.querySelector('.countdown-icon');
      const textSpan = el.querySelector('.countdown-text');
      if (iconSpan) iconSpan.innerHTML = renderCountdownIcon(el.id.replace('countdown-', ''), ffl);
      if (textSpan) textSpan.textContent = renderCountdownText(ffl);
    });
    renderIcons();
  } catch (err) {
    console.error('Error actualizando countdowns:', err);
  }
}

function renderCompletedCard(tarea) {
  const fReal = new Date(tarea.fecha_limite_real).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });

  return `
    <div class="task-card border-safe">
      <div class="task-header">
        <h3 class="task-title">${escapeHTML(tarea.titulo)}</h3>
        <div class="task-header-right">
          <span class="task-status enviada">${tarea.estado}</span>
          <button class="btn-delete" onclick="deleteTask(${tarea.id})" title="Eliminar tarea">${icon('trash-2', 'icon-only')}</button>
        </div>
      </div>
      <p class="task-desc">${escapeHTML(tarea.descripcion || 'Sin descripción.')}</p>
      <div class="task-dates info-panel">
        <div class="date-block">
          <strong>FFL</strong>
          <span class="ffl-primary">${formatRelativeDate(tarea.fecha_limite_falsa)}</span>
          <span class="real-trigger" tabindex="0" role="button" aria-label="Ver límite oficial">
            ${icon('info')}
            <span class="real-tooltip">
            <span class="real-tooltip-label">Límite Oficial</span>
            <span class="real-tooltip-date">${fReal}</span>
          </span>
          </span>
        </div>
      </div>
      <div class="task-actions">
        <span style="color: #10b981; font-weight: 600; font-size: 0.85rem; text-align: center; width: 100%;">${icon('shield-check')}Tarea entregada con éxito a tiempo. ¡Excelente!</span>
      </div>
    </div>
  `;
}

async function createTask(e) {
  e.preventDefault();
  initAudio();

  const titulo = document.getElementById('task-title').value.trim();
  const descripcion = document.getElementById('task-desc').value.trim();
  const fechaLimiteReal = document.getElementById('task-deadline').value;

  if (!titulo || !fechaLimiteReal) {
    showToast('Completa todos los campos obligatorios.', 'error');
    return;
  }

  const localDate = new Date(fechaLimiteReal);
  const fechaUtc = localDate.toISOString();

  const submitBtn = document.querySelector('#task-form .btn-submit');
  setLoading(submitBtn, true);

  try {
    const res = await apiFetch(`${CONFIG.API_BASE}/tareas`, {
      method: 'POST',
      body: JSON.stringify({
        titulo,
        descripcion,
        fecha_limite_real: fechaUtc
      })
    });
    if (!res) return;

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'No se pudo crear la tarea');
    }

    document.getElementById('task-form').reset();
    fetchTasks();
    showToast('Tarea creada con FFL calculada.', 'success');
  } catch (err) {
    // Intentar encolar para background sync si hay service worker
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({
          type: 'queue-task',
          task: { titulo, descripcion, fecha_limite_real: fechaUtc }
        });
        showToast('Sin conexion. La tarea se sincronizara automaticamente.', 'info', 5000);
        document.getElementById('task-form').reset();
      } catch (swErr) {
        showToast(`Error: ${err.message}`, 'error');
      }
    } else {
      showToast(`Error: ${err.message}`, 'error');
    }
  } finally {
    setLoading(submitBtn, false);
  }
}

window.updateTaskStatus = async function(id, nuevoEstado) {
  initAudio();

  const estadoFinal = nuevoEstado === 'En Enviada' ? 'Enviada' : nuevoEstado;

  try {
    const res = await apiFetch(`${CONFIG.API_BASE}/tareas/${id}/estado`, {
      method: 'PUT',
      body: JSON.stringify({ nuevoEstado: estadoFinal })
    });
    if (!res) return;

    const data = await res.json();

    if (!res.ok) {
      showToast(`${data.error}`, 'error');
      return;
    }

    fetchTasks();
    showToast(`${data.mensaje}`, 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

function evaluateGlobalAlarms(tareas) {
  if (isSilenced) return;

  const activas = tareas.filter(t => t.estado !== 'Enviada');

  let maxAlarma = 'Ninguno';

  const jerarquia = { 'Ninguno': 0, 'Bajo': 1, 'Moderado': 2, 'Alto (Crítico)': 3, '¡MÁXIMO PELIGRO (CRÍTICO)!': 4 };

  activas.forEach(t => {
    const nivelActual = t.alarma.nivel;

    if (jerarquia[nivelActual] > jerarquia[maxAlarma]) {
      maxAlarma = nivelActual;
    }

    if (nivelActual === 'Alto (Crítico)' || nivelActual === '¡MÁXIMO PELIGRO (CRÍTICO)!') {
      sendNativeNotification(t);
    }
  });

  const panicBar = document.getElementById('global-panic-bar');

  if (maxAlarma === '¡MÁXIMO PELIGRO (CRÍTICO)!') {
    panicBar.classList.remove('panic-hidden');
    panicBar.classList.add('panic-active');
    startAudioAlarmLoop('¡MÁXIMO PELIGRO (CRÍTICO)!');
  } else if (maxAlarma === 'Alto (Crítico)') {
    panicBar.classList.add('panic-hidden');
    panicBar.classList.remove('panic-active');
    startAudioAlarmLoop('Alto (Crítico)');
  } else if (maxAlarma === 'Moderado') {
    panicBar.classList.add('panic-hidden');
    panicBar.classList.remove('panic-active');
    startAudioAlarmLoop('Moderado');
  } else {
    panicBar.classList.add('panic-hidden');
    panicBar.classList.remove('panic-active');
    stopAudioAlarmLoop();
  }
}

async function fetchConfig() {
  try {
    const res = await apiFetch(`${CONFIG.API_BASE}/configuracion`);
    if (!res) return;
    const data = await res.json();
    document.getElementById('margin-input').value = data.margen_horas;
  } catch (err) {
    console.warn('No se pudo cargar la configuración del margen FFL:', err.message);
  }
}

async function updateMarginHours() {
  const input = document.getElementById('margin-input');
  const feedback = document.getElementById('margin-feedback');
  const margenHoras = parseInt(input.value, 10);

  if (isNaN(margenHoras) || margenHoras < 1 || margenHoras > 72) {
    feedback.textContent = 'Ingresa un valor entre 1 y 72 horas.';
    feedback.className = 'margin-feedback error';
    return;
  }

  const saveBtn = document.getElementById('save-margin-btn');
  setLoading(saveBtn, true);

  try {
    const res = await apiFetch(`${CONFIG.API_BASE}/configuracion`, {
      method: 'PUT',
      body: JSON.stringify({ margen_horas: margenHoras })
    });
    if (!res) return;

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al guardar');
    }

    feedback.textContent = `${data.mensaje}`;
    feedback.className = 'margin-feedback success';
    fetchTasks();
  } catch (err) {
    feedback.textContent = `Error: ${err.message}`;
    feedback.className = 'margin-feedback error';
  } finally {
    setLoading(saveBtn, false);
  }
}

window.deleteTask = async function(id) {
  showConfirmModal('¿Estás seguro de eliminar esta tarea permanentemente?', async () => {
    try {
      const res = await apiFetch(`${CONFIG.API_BASE}/tareas/${id}`, {
        method: 'DELETE'
      });
      if (!res) return;

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'No se pudo eliminar la tarea');
      }

      fetchTasks();
    } catch (err) {
      showToast(`Error al eliminar: ${err.message}`, 'error');
    }
  });
};

function updateNotifBtn() {
  const btn = document.getElementById('notif-permit-btn');
  if (notificationsEnabled) {
    btn.innerHTML = `${icon('bell')}Activadas`;
    btn.classList.add('notif-active');
  } else {
    btn.innerHTML = icon('bell', 'icon-only');
    btn.classList.remove('notif-active');
  }
  renderIcons();
}

function restoreNotifState() {
  const saved = localStorage.getItem(NOTIF_ENABLED_KEY);
  if (saved === 'true' && 'Notification' in window && Notification.permission === 'granted') {
    notificationsEnabled = true;
  }
  updateNotifBtn();
}

async function requestNotificationPermission() {
  if (notificationsEnabled) {
    notificationsEnabled = false;
    localStorage.setItem(NOTIF_ENABLED_KEY, 'false');
    updateNotifBtn();
    return;
  }

  if (!('Notification' in window)) {
    showToast('Este navegador no soporta notificaciones.', 'error');
    return;
  }

  if (Notification.permission === 'denied') {
    showToast('Notificaciones bloqueadas en el navegador.', 'error');
    return;
  }

  if (Notification.permission === 'granted') {
    notificationsEnabled = true;
    localStorage.setItem(NOTIF_ENABLED_KEY, 'true');
    updateNotifBtn();
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    notificationsEnabled = true;
    localStorage.setItem(NOTIF_ENABLED_KEY, 'true');
    updateNotifBtn();
  }
}

function sendNativeNotification(tarea) {
  if (!notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (isTaskNotified(tarea.id)) return;

  markTaskAsNotified(tarea.id);

  const esCritico = tarea.alarma.nivel === '¡MÁXIMO PELIGRO (CRÍTICO)!';
  const title = `Acción requerida: ${tarea.titulo}`;
  const body = esCritico
    ? 'La Falsa Fecha Límite ha vencido. Completa la tarea cuanto antes.'
    : 'Queda menos de 1 hora para la Falsa Fecha Límite.';

  try {
    const notif = new Notification(title, {
      body,
      icon: '/icons/icon-512.svg',
      badge: '/icons/icon-192.svg',
      tag: `critico-${tarea.id}`,
      data: { tareaId: tarea.id },
      vibrate: [300, 100, 300],
      requireInteraction: true,
      actions: [
        { action: 'complete', title: 'Completar' },
        { action: 'snooze', title: 'Posponer' }
      ]
    });

    notif.addEventListener('click', () => {
      window.focus();
      notif.close();
    });
  } catch (err) {
    console.warn('No se pudo enviar la notificación nativa:', err.message);
  }
}

/* ---- ANALYTICS / DASHBOARD ---- */

function initAnalytics() {
  const details = document.querySelector('.analytics-details');
  if (!details || details._analyticsInit) return;
  details._analyticsInit = true;
  details.addEventListener('toggle', () => {
    if (details.open) {
      fetchAnalytics();
    }
  });
}

async function fetchAnalytics() {
  const grid = document.getElementById('analytics-grid');
  grid.innerHTML = '<p class="stat-label" style="text-align:center;padding:20px;">Cargando metricas...</p>';

  try {
    const res = await apiFetch(`${CONFIG.API_BASE}/analytics`);
    if (!res) return;
    const data = await res.json();
    renderAnalytics(data);
  } catch (err) {
    grid.innerHTML = '<p class="stat-label" style="text-align:center;padding:20px;color:var(--color-panic);">Error al cargar metricas.</p>';
  }
}

function renderAnalytics(d) {
  const grid = document.getElementById('analytics-grid');

  const cards = [
    { label: 'Total Tareas', value: d.totalTareas, color: 'cyan' },
    { label: 'Completadas a Tiempo', value: d.onTime, color: 'green', extra: `${d.tasaExito}% exito` },
    { label: 'Completadas tarde', value: d.lateFFL, color: 'yellow' },
    { label: 'Vencidas', value: d.overdue, color: 'red' },
    { label: 'Racha actual', value: `${d.streak}`, color: 'magenta', extra: d.streak === 1 ? 'entrega' : 'entregas' },
    { label: 'Promedio entrega', value: `${d.promedioHorasAntes}h`, color: 'cyan', extra: 'antes de FFL' },
    { label: 'Pendientes', value: d.pendientes, color: 'yellow' },
    { label: 'En Progreso', value: d.enProgreso, color: 'orange' },
    { label: 'Criticas ( < 1h )', value: d.tareasCriticas, color: 'red' }
  ];

  grid.innerHTML = cards.map(c => `
    <div class="stat-card stat-${c.color}">
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
      ${c.extra ? `<div class="stat-label" style="font-size:0.65rem;margin-top:2px;">${c.extra}</div>` : ''}
    </div>
  `).join('');

  renderIcons();
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g,
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

/* ---- CONFIRM MODAL ---- */

function showConfirmModal(message, onConfirm) {
  const existing = document.querySelector('.confirm-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';

  overlay.innerHTML = `
    <div class="confirm-modal">
      <div class="confirm-modal-icon">${icon('alert-triangle')}</div>
      <p class="confirm-modal-msg">${escapeHTML(message)}</p>
      <div class="confirm-modal-actions">
        <button class="btn btn-cancel" data-action="cancel">Cancelar</button>
        <button class="btn btn-danger" data-action="confirm">Confirmar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    renderIcons();
  });

  overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
  });

  overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', () => {
      overlay.remove();
      onConfirm();
    }, { once: true });
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('visible');
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    }
  });
}