// Configuración del API
const API_BASE = 'http://localhost:3000/api';

// Sistema de Audio - Web Audio API (Generador de Alarma Agresiva)
let audioCtx = null;
let alarmIntervalId = null;
let isSilenced = false;
let silenceTimeoutId = null;

// Control de notificaciones nativas
const notifiedTasks = new Set();
let notificationsEnabled = false;

// Inicializar el contexto de audio en la primera interacción del usuario (política de navegadores)
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

// Generar un pitido de alarma súper molesto usando Web Audio API (sin dependencias externas)
function playBeep(frequency = 880, duration = 0.15) {
  if (!audioCtx) return;
  
  // Si el audio está suspendido (Chrome/Edge), reanudarlo
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  // Tipo de onda cuadrada (más estridente y molesta para romper el sueño)
  osc.type = 'sawtooth'; 
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

  // Controlar volumen agresivo pero seguro
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

// Iniciar la ráfaga de alarmas según la gravedad
function startAudioAlarmLoop(nivel) {
  stopAudioAlarmLoop();

  if (isSilenced) return;

  let intervalMs = 0;
  let freq = 880;

  if (nivel === '¡MÁXIMO PELIGRO (CRÍTICO)!') {
    intervalMs = 800; // Pitido cada 0.8s
    freq = 1100;      // Tono agudo penetrante
  } else if (nivel === 'Alto (Crítico)') {
    intervalMs = 2500; // Pitido cada 2.5s
    freq = 880;
  } else if (nivel === 'Moderado') {
    intervalMs = 10000; // Pitido cada 10s
    freq = 660;
  }

  if (intervalMs > 0) {
    // Un pitido inicial
    playBeep(freq, 0.2);
    // Bucle continuo
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

// --- MANEJO DEL DOM Y CONEXIÓN API ---

document.addEventListener('DOMContentLoaded', () => {
  // Intentar registrar el Service Worker para soporte PWA
  registerServiceWorker();

  // Cargar Tareas y Configuración al inicio
  fetchTasks();
  fetchConfig();

  // Listeners de eventos
  document.getElementById('refresh-tasks').addEventListener('click', fetchTasks);
  document.getElementById('task-form').addEventListener('submit', createTask);
  document.getElementById('save-margin-btn').addEventListener('click', updateMarginHours);
  
  document.getElementById('notif-permit-btn').addEventListener('click', requestNotificationPermission);
  
  document.getElementById('silence-btn').addEventListener('click', () => {
    initAudio();
    isSilenced = true;
    stopAudioAlarmLoop();
    document.getElementById('global-panic-bar').classList.remove('panic-active');
    document.getElementById('global-panic-bar').classList.add('panic-hidden');
    console.log('Alarma silenciada por 3 minutos.');
    
    // Auto-restablecer silencio tras 3 minutos (para evitar que se duerma indefinidamente)
    if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
    silenceTimeoutId = setTimeout(() => {
      isSilenced = false;
      fetchTasks(); // Reevaluar alarmas
    }, 180000); // 3 minutos
  });

  // Iniciar cuenta regresiva en vivo (actualiza cada 30s)
  startCountdown();

  // Activar audio en el primer click de la pantalla
  document.body.addEventListener('click', () => {
    initAudio();
  }, { once: true });
});

function startCountdown() {
  if (countdownIntervalId) clearInterval(countdownIntervalId);
  updateAllCountdowns();
  countdownIntervalId = setInterval(updateAllCountdowns, 30000);
}

// Registrar Service Worker de PWA
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('✅ Service Worker registrado con éxito en el alcance:', reg.scope);
    } catch (err) {
      console.warn('⚠️ No se pudo registrar el Service Worker de la PWA:', err.message);
    }
  }
}

// Obtener tareas y renderizarlas
async function fetchTasks() {
  const container = document.getElementById('tasks-list');
  
  try {
    const res = await fetch(`${API_BASE}/tareas`);
    if (!res.ok) throw new Error('Error al conectar con la API');
    
    const tareas = await res.json();
    renderTasks(tareas);
    evaluateGlobalAlarms(tareas);
    updateAllCountdowns();
  } catch (err) {
    console.error('fetchTasks error:', err);
    container.innerHTML = `
      <div class="empty-state">
        <p style="color: #ef4444;">❌ No se pudo conectar con el servidor Express backend.</p>
        <p style="font-size: 0.85rem; margin-top: 10px;">Asegúrate de que 'docker-compose up' esté corriendo correctamente.</p>
      </div>
    `;
  }
}

// Renderizar tarjetas separando activas de completadas
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
        <p>🎉 ¡Excelente! No tienes tareas pendientes actualmente.</p>
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
  '¡MÁXIMO PELIGRO (CRÍTICO)!': 'FFL Vencida — Acción Inmediata'
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

// Tarjeta resumida para tarea completada
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

// Crear una tarea nueva mediante el formulario
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

  // Convertir la hora local del input (UTC-5 Perú) a ISO UTC
  // para evitar el timezone bug al guardar en MySQL (Docker corre en UTC)
  const localDate = new Date(fechaLimiteReal);
  const fechaUtc = localDate.toISOString();

  try {
    const res = await fetch(`${API_BASE}/tareas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo,
        descripcion,
        fecha_limite_real: fechaUtc
      })
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'No se pudo crear la tarea');
    }

    // Resetear formulario y recargar tareas
    document.getElementById('task-form').reset();
    fetchTasks();
    showToast('🎉 Tarea creada con FFL calculada.', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// Actualizar el estado de una tarea aplicando validación estricta
window.updateTaskStatus = async function(id, nuevoEstado) {
  initAudio();
  
  // Limpieza del parámetro si hay error de string (como 'En Enviada' que pusimos por claridad de estado)
  const estadoFinal = nuevoEstado === 'En Enviada' ? 'Enviada' : nuevoEstado;

  try {
    const res = await fetch(`${API_BASE}/tareas/${id}/estado`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nuevoEstado: estadoFinal })
    });

    const data = await res.json();

    if (!res.ok) {
      // Mostrar el error estricto de la máquina de estados
      showToast(`⚠️ ${data.error}`, 'error');
      return;
    }

    fetchTasks();
    showToast(`✅ ${data.mensaje}`, 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

// Evaluar el nivel general de alarmas activas en la app para disparar alarmas sonoras, interfaz de pánico y notificaciones nativas
function evaluateGlobalAlarms(tareas) {
  if (isSilenced) return;

  // Filtrar tareas que no han sido entregadas
  const activas = tareas.filter(t => t.estado !== 'Enviada');

  // Encontrar la alarma con el nivel de gravedad más alto
  let maxAlarma = 'Ninguno';
  
  const jerarquia = { 'Ninguno': 0, 'Bajo': 1, 'Moderado': 2, 'Alto (Crítico)': 3, '¡MÁXIMO PELIGRO (CRÍTICO)!': 4 };

  activas.forEach(t => {
    const nivelActual = t.alarma.nivel;

    if (jerarquia[nivelActual] > jerarquia[maxAlarma]) {
      maxAlarma = nivelActual;
    }

    // Disparar notificación nativa si la tarea entra en estado crítico o máximo peligro
    if (nivelActual === 'Alto (Crítico)' || nivelActual === '¡MÁXIMO PELIGRO (CRÍTICO)!') {
      sendNativeNotification(
        `⚠️ "${t.titulo}" — ${nivelActual}. Te quedan menos de 1 hora para tu Falsa Fecha Límite. ¡Entrega YA!`,
        t.id
      );
    }
  });

  const panicBar = document.getElementById('global-panic-bar');

  // Si hay alguna tarea en máximo peligro, activar la pantalla estroboscópica de pánico y play beeper
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
    // Apagar alarmas
    panicBar.classList.add('panic-hidden');
    panicBar.classList.remove('panic-active');
    stopAudioAlarmLoop();
  }
}

// Obtener configuración actual del margen FFL
async function fetchConfig() {
  try {
    const res = await fetch(`${API_BASE}/configuracion`);
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('margin-input').value = data.margen_horas;
  } catch (err) {
    console.warn('No se pudo cargar la configuración del margen FFL:', err.message);
  }
}

// Actualizar el margen de horas (colchón FFL)
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
    const res = await fetch(`${API_BASE}/configuracion`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ margen_horas: margenHoras })
    });

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

// Eliminar tarea físicamente
window.deleteTask = async function(id) {
  if (!confirm('¿Estás seguro de eliminar esta tarea permanentemente?')) return;

  try {
    const res = await fetch(`${API_BASE}/tareas/${id}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'No se pudo eliminar la tarea');
    }

    fetchTasks();
  } catch (err) {
    showToast(`Error al eliminar: ${err.message}`, 'error');
  }
};

// Alternar activación/desactivación de notificaciones nativas
async function requestNotificationPermission() {
  const btn = document.getElementById('notif-permit-btn');

  // Si ya están activadas, desactivar
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

  // Solicitar permiso por primera vez
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    notificationsEnabled = true;
    btn.textContent = '🔔 Activadas';
    btn.classList.add('notif-active');
  }
}

// Enviar notificación nativa al sistema operativo
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

// Escapar cadenas HTML para evitar vulnerabilidades XSS en las vistas
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
