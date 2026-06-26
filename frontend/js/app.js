const API_BASE = 'http://localhost:3000/api';

let audioCtx = null;
let alarmIntervalId = null;
let isSilenced = false;
let silenceTimeoutId = null;

const notifiedTasks = new Set();
let notificationsEnabled = false;

/* ---- TOKEN / AUTH HELPERS ---- */

function getToken() {
  return localStorage.getItem('jwt_token');
}

function setToken(token) {
  localStorage.setItem('jwt_token', token);
}

function clearToken() {
  localStorage.removeItem('jwt_token');
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

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...getAuthHeaders(), ...options.headers }
  });
  if (res.status === 401) {
    clearToken();
    showAuth();
    showToast('Sesión expirada. Inicia sesión nuevamente.', 'error');
    return null;
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
    document.getElementById('user-badge').textContent = `👤 ${username}`;
  }
}

function showAuth() {
  document.getElementById('auth-container').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';
  stopAudioAlarmLoop();
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
    const res = await fetch(`${API_BASE}/login`, {
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
    const res = await fetch(`${API_BASE}/register`, {
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
  document.getElementById('theme-toggle').textContent = isLight ? '☀️' : '🌙';
}

function applySavedTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.textContent = '☀️';
  }
}

/* ---- INICIALIZACIÓN DE EVENTOS (una sola vez) ---- */

function initAppEvents() {
  document.getElementById('refresh-tasks').addEventListener('click', fetchTasks);
  document.getElementById('task-form').addEventListener('submit', createTask);
  document.getElementById('save-margin-btn').addEventListener('click', updateMarginHours);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
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
  fetchTasks();
  fetchConfig();
}

document.addEventListener('DOMContentLoaded', () => {
  applySavedTheme();
  initAppEvents();
  registerServiceWorker();

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
  if (countdownIntervalId) clearInterval(countdownIntervalId);
  updateAllCountdowns();
  countdownIntervalId = setInterval(updateAllCountdowns, 30000);
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

  try {
    const res = await apiFetch(`${API_BASE}/tareas`);
    if (!res) return;

    const tareas = await res.json();
    renderTasks(tareas);
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

function renderTasks(tareas) {
  const container = document.getElementById('tasks-list');
  const historyContainer = document.getElementById('history-list');
  const historyCount = document.getElementById('history-count');

  const activas = tareas.filter(t => t.estado !== 'Enviada');
  const completadas = tareas.filter(t => t.estado === 'Enviada');

  historyCount.textContent = completadas.length;

  if (activas.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Excelente! No tienes tareas pendientes actualmente.</p>
        <p style="font-size: 0.85rem; margin-top: 10px;">Añade una nueva tarea a la izquierda para activar el escudo anti-procrastinación.</p>
      </div>
    `;
  } else {
    container.innerHTML = activas.map(tarea => renderActiveCard(tarea)).join('');
  }

  if (completadas.length === 0) {
    historyContainer.innerHTML = `<div class="empty-state"><p>Aún no hay tareas completadas.</p></div>`;
  } else {
    historyContainer.innerHTML = completadas.map(tarea => renderCompletedCard(tarea)).join('');
  }
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
  const fFalsa = new Date(tarea.fecha_limite_falsa).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });

  let actionButtons = '';
  if (tarea.estado === 'Pendiente') {
    actionButtons = `
      <button class="btn-action btn-start" onclick="updateTaskStatus(${tarea.id}, 'En Progreso')">
        ⚡ Empezar Trabajo (Pendiente ➔ En Progreso)
      </button>
    `;
  } else if (tarea.estado === 'En Progreso') {
    actionButtons = `
      <button class="btn-action btn-submit-task" onclick="updateTaskStatus(${tarea.id}, 'En Enviada')">
        📤 Marcar como Entregado
      </button>
    `;
  }

  const alertLabel = ALERT_LABELS[tarea.alarma.nivel] || tarea.alarma.nivel;
  const countdownHtml = renderCountdown(tarea.id, tarea.fecha_limite_falsa);

  return `
    <div class="task-card ${borderClass}">
      <div class="task-header">
        <h3 class="task-title">${escapeHTML(tarea.titulo)}</h3>
        <div class="task-header-right">
          <span class="task-status ${tarea.estado.toLowerCase().replace(' ', '-')}">${tarea.estado}</span>
          <button class="btn-delete" onclick="deleteTask(${tarea.id})" title="Eliminar tarea">🗑️</button>
        </div>
      </div>
      <p class="task-desc">${escapeHTML(tarea.descripcion || 'Sin descripción.')}</p>
      <div class="task-dates">
        <div class="date-block">
          <strong>Límite Oficial:</strong>
          <span>${fReal}</span>
        </div>
        <div class="date-block" style="color: var(--color-warning);">
          <strong>Falsa Fecha Límite (FFL):</strong>
          <span>${fFalsa}</span>
        </div>
      </div>
      <div id="countdown-${tarea.id}" class="task-countdown" data-ffl="${tarea.fecha_limite_falsa}">${countdownHtml}</div>
      <div class="task-alarm-info ${alarmClass}">
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

function renderCountdown(id, fechaLimiteFalsa) {
  const ffl = new Date(fechaLimiteFalsa);
  const ahora = new Date();
  const diffMs = ffl - ahora;

  if (diffMs > 0) {
    return `⏳ Faltan ${formatCountdown(fechaLimiteFalsa)}`;
  }

  return `⚠️ Vencida ${formatCountdown(fechaLimiteFalsa)}`;
}

function updateAllCountdowns() {
  try {
    document.querySelectorAll('[id^="countdown-"]').forEach(el => {
      const ffl = el.dataset.ffl;
      if (!ffl) return;
      el.textContent = renderCountdown(el.id.replace('countdown-', ''), ffl);
    });
  } catch (err) {
    console.error('Error actualizando countdowns:', err);
  }
}

function renderCompletedCard(tarea) {
  const fReal = new Date(tarea.fecha_limite_real).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  const fFalsa = new Date(tarea.fecha_limite_falsa).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });

  return `
    <div class="task-card border-safe">
      <div class="task-header">
        <h3 class="task-title">${escapeHTML(tarea.titulo)}</h3>
        <div class="task-header-right">
          <span class="task-status enviada">${tarea.estado}</span>
          <button class="btn-delete" onclick="deleteTask(${tarea.id})" title="Eliminar tarea">🗑️</button>
        </div>
      </div>
      <p class="task-desc">${escapeHTML(tarea.descripcion || 'Sin descripción.')}</p>
      <div class="task-dates">
        <div class="date-block">
          <strong>Límite Oficial:</strong>
          <span>${fReal}</span>
        </div>
        <div class="date-block" style="color: var(--color-warning);">
          <strong>Falsa Fecha Límite (FFL):</strong>
          <span>${fFalsa}</span>
        </div>
      </div>
      <div class="task-actions">
        <span style="color: #10b981; font-weight: 600; font-size: 0.85rem; text-align: center; width: 100%;">🛡️ Tarea entregada con éxito a tiempo. ¡Excelente!</span>
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

  try {
    const res = await apiFetch(`${API_BASE}/tareas`, {
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
    showToast('🎉 Tarea creada con FFL calculada.', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

window.updateTaskStatus = async function(id, nuevoEstado) {
  initAudio();

  const estadoFinal = nuevoEstado === 'En Enviada' ? 'Enviada' : nuevoEstado;

  try {
    const res = await apiFetch(`${API_BASE}/tareas/${id}/estado`, {
      method: 'PUT',
      body: JSON.stringify({ nuevoEstado: estadoFinal })
    });
    if (!res) return;

    const data = await res.json();

    if (!res.ok) {
      showToast(`⚠️ ${data.error}`, 'error');
      return;
    }

    fetchTasks();
    showToast(`✅ ${data.mensaje}`, 'success');
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
      sendNativeNotification(
        `⚠️ "${t.titulo}" — ${nivelActual}. Te quedan menos de 1 hora para tu Falsa Fecha Límite. ¡Entrega YA!`,
        t.id
      );
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
    const res = await apiFetch(`${API_BASE}/configuracion`);
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
    feedback.textContent = '❌ Ingresa un valor entre 1 y 72 horas.';
    feedback.className = 'margin-feedback error';
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/configuracion`, {
      method: 'PUT',
      body: JSON.stringify({ margen_horas: margenHoras })
    });
    if (!res) return;

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al guardar');
    }

    feedback.textContent = `✅ ${data.mensaje}`;
    feedback.className = 'margin-feedback success';
    fetchTasks();
  } catch (err) {
    feedback.textContent = `❌ Error: ${err.message}`;
    feedback.className = 'margin-feedback error';
  }
}

window.deleteTask = async function(id) {
  if (!confirm('¿Estás seguro de eliminar esta tarea permanentemente?')) return;

  try {
    const res = await apiFetch(`${API_BASE}/tareas/${id}`, {
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
};

async function requestNotificationPermission() {
  const btn = document.getElementById('notif-permit-btn');

  if (notificationsEnabled) {
    notificationsEnabled = false;
    btn.textContent = '🔔';
    btn.classList.remove('notif-active');
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
    btn.textContent = '🔔 Activadas';
    btn.classList.add('notif-active');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    notificationsEnabled = true;
    btn.textContent = '🔔 Activadas';
    btn.classList.add('notif-active');
  }
}

function sendNativeNotification(titulo, tareaId) {
  if (!notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (notifiedTasks.has(tareaId)) return;

  notifiedTasks.add(tareaId);

  try {
    const notif = new Notification('🚨 Alarma Anti-Procrastinación', {
      body: titulo,
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
      tag: `critico-${tareaId}`,
      vibrate: [300, 100, 300],
      requireInteraction: true
    });

    notif.addEventListener('click', () => {
      window.focus();
      notif.close();
    });
  } catch (err) {
    console.warn('No se pudo enviar la notificación nativa:', err.message);
  }
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