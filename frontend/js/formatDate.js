const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function normalizeDate(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatTime(date) {
  return date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function formatRelativeDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();

  const todayStart = normalizeDate(now);
  const targetStart = normalizeDate(date);

  const diffDays = Math.round((targetStart - todayStart) / (1000 * 60 * 60 * 24));
  const timeStr = formatTime(date);

  if (diffDays === 0) {
    return `Hoy, ${timeStr}`;
  }

  if (diffDays === 1) {
    return `Mañana, ${timeStr}`;
  }

  const dayName = DAY_NAMES[date.getDay()];
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);

  return `${dayName}, ${day}/${month}/${year}, ${timeStr}`;
}
