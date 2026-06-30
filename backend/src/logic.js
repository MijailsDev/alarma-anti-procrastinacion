export const ESTADOS = {
  PENDIENTE: 'Pendiente',
  EN_PROGRESO: 'En Progreso',
  ENVIADA: 'Enviada'
};

export function isValidTransition(estadoActual, estadoNuevo) {
  if (estadoActual === ESTADOS.PENDIENTE && estadoNuevo === ESTADOS.EN_PROGRESO) return true;
  if (estadoActual === ESTADOS.EN_PROGRESO && estadoNuevo === ESTADOS.ENVIADA) return true;
  return false;
}

export function calcularAlarma(fechaLimiteFalsa, estado) {
  if (estado === ESTADOS.ENVIADA) {
    return { nivel: 'Ninguno', frecuenciaSegundos: 0, mensaje: 'Tarea completada. Alarma inactiva.' };
  }

  const ffl = new Date(fechaLimiteFalsa);
  const ahora = new Date();
  const diferenciaMilisegundos = ffl - ahora;
  const diferenciaHoras = diferenciaMilisegundos / (1000 * 60 * 60);

  if (diferenciaHoras > 5) {
    return {
      nivel: 'Bajo',
      color: '#28a745',
      frecuenciaSegundos: 3600,
      mensaje: 'Tranquilo, estas a buen tiempo respecto a tu Falsa Fecha Limite.'
    };
  } else if (diferenciaHoras > 1 && diferenciaHoras <= 5) {
    return {
      nivel: 'Moderado',
      color: '#ffc107',
      frecuenciaSegundos: 900,
      mensaje: 'Atencion! La Falsa Fecha Limite se acerca. Empieza a avanzar.'
    };
  } else if (diferenciaHoras > 0 && diferenciaHoras <= 1) {
    return {
      nivel: 'Alto (Crítico)',
      color: '#fd7e14',
      frecuenciaSegundos: 60,
      mensaje: 'URGENTE! Te queda menos de 1 hora para tu Falsa Fecha Limite.'
    };
  } else {
    return {
      nivel: '¡MÁXIMO PELIGRO (CRÍTICO)!',
      color: '#dc3545',
      frecuenciaSegundos: 5,
      mensaje: 'ALERTA AGRESIVA! Has superado tu Falsa Fecha Limite y la tarea NO ha sido enviada. ENTREGA YA!'
    };
  }
}
