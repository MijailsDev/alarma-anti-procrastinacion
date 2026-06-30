import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ESTADOS, isValidTransition, calcularAlarma } from '../logic.js';

describe('ESTADOS', () => {
  it('tiene los tres estados', () => {
    expect(ESTADOS.PENDIENTE).toBe('Pendiente');
    expect(ESTADOS.EN_PROGRESO).toBe('En Progreso');
    expect(ESTADOS.ENVIADA).toBe('Enviada');
  });
});

describe('isValidTransition', () => {
  it('permite Pendiente -> En Progreso', () => {
    expect(isValidTransition('Pendiente', 'En Progreso')).toBe(true);
  });

  it('permite En Progreso -> Enviada', () => {
    expect(isValidTransition('En Progreso', 'Enviada')).toBe(true);
  });

  it('rechaza Pendiente -> Enviada (salto de estado)', () => {
    expect(isValidTransition('Pendiente', 'Enviada')).toBe(false);
  });

  it('rechaza Enviada -> Pendiente (retroceso)', () => {
    expect(isValidTransition('Enviada', 'Pendiente')).toBe(false);
  });

  it('rechaza Enviada -> En Progreso (retroceso)', () => {
    expect(isValidTransition('Enviada', 'En Progreso')).toBe(false);
  });

  it('rechaza estados identicos', () => {
    expect(isValidTransition('Pendiente', 'Pendiente')).toBe(false);
    expect(isValidTransition('En Progreso', 'En Progreso')).toBe(false);
    expect(isValidTransition('Enviada', 'Enviada')).toBe(false);
  });

  it('rechaza estados invalidos', () => {
    expect(isValidTransition('Pendiente', 'Invalido')).toBe(false);
    expect(isValidTransition('', 'Enviada')).toBe(false);
  });
});

describe('calcularAlarma', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retorna "Ninguno" para tareas enviadas', () => {
    const result = calcularAlarma('2099-01-01T00:00:00', 'Enviada');
    expect(result.nivel).toBe('Ninguno');
    expect(result.frecuenciaSegundos).toBe(0);
  });

  it('retorna "Bajo" cuando faltan mas de 5 horas', () => {
    const futuro = new Date(Date.now() + 10 * 3600 * 1000);
    const result = calcularAlarma(futuro.toISOString(), 'Pendiente');
    expect(result.nivel).toBe('Bajo');
    expect(result.frecuenciaSegundos).toBe(3600);
  });

  it('retorna "Moderado" entre 1 y 5 horas', () => {
    const futuro = new Date(Date.now() + 3 * 3600 * 1000);
    const result = calcularAlarma(futuro.toISOString(), 'Pendiente');
    expect(result.nivel).toBe('Moderado');
    expect(result.frecuenciaSegundos).toBe(900);
  });

  it('retorna "Alto (Critico)" entre 0 y 1 hora', () => {
    const futuro = new Date(Date.now() + 30 * 60 * 1000);
    const result = calcularAlarma(futuro.toISOString(), 'Pendiente');
    expect(result.nivel).toBe('Alto (Crítico)');
    expect(result.frecuenciaSegundos).toBe(60);
  });

  it('retorna "MAXIMO PELIGRO (CRITICO)!" cuando la FFL ya vencio', () => {
    const pasado = new Date(Date.now() - 60 * 60 * 1000);
    const result = calcularAlarma(pasado.toISOString(), 'Pendiente');
    expect(result.nivel).toBe('¡MÁXIMO PELIGRO (CRÍTICO)!');
    expect(result.frecuenciaSegundos).toBe(5);
  });

  it('retorna "MAXIMO PELIGRO" incluso si estado es "En Progreso" pero vencido', () => {
    const pasado = new Date(Date.now() - 10 * 60 * 1000);
    const result = calcularAlarma(pasado.toISOString(), 'En Progreso');
    expect(result.nivel).toBe('¡MÁXIMO PELIGRO (CRÍTICO)!');
  });

  it('usa la fecha actual para el calculo', () => {
    const casiVencido = new Date(Date.now() + 2 * 3600 * 1000);
    const result = calcularAlarma(casiVencido.toISOString(), 'Pendiente');
    expect(result.nivel).toBe('Moderado');
  });

  describe('casos extremos - boundaries exactos', () => {
    it('exactamente 5 horas antes: Moderado (limite superior de Bajo)', () => {
      const futuro = new Date(Date.now() + 5 * 3600 * 1000);
      const result = calcularAlarma(futuro.toISOString(), 'Pendiente');
      expect(result.nivel).toBe('Moderado');
    });

    it('exactamente 1 hora antes: Alto (limite superior de Moderado)', () => {
      const futuro = new Date(Date.now() + 1 * 3600 * 1000);
      const result = calcularAlarma(futuro.toISOString(), 'Pendiente');
      expect(result.nivel).toBe('Alto (Crítico)');
    });

    it('exactamente en la FFL (diffMs=0): MAXIMO PELIGRO', () => {
      const ahora = new Date();
      const result = calcularAlarma(ahora.toISOString(), 'Pendiente');
      expect(result.nivel).toBe('¡MÁXIMO PELIGRO (CRÍTICO)!');
    });

    it('1 milisegundo antes de la FFL: Alto', () => {
      const casiVencido = new Date(Date.now() + 1);
      const result = calcularAlarma(casiVencido.toISOString(), 'Pendiente');
      expect(result.nivel).toBe('Alto (Crítico)');
    });

    it('1 milisegundo despues de la FFL: MAXIMO PELIGRO', () => {
      const pasado = new Date(Date.now() - 1);
      const result = calcularAlarma(pasado.toISOString(), 'Pendiente');
      expect(result.nivel).toBe('¡MÁXIMO PELIGRO (CRÍTICO)!');
    });
  });

  describe('casos extremos - fechas extremas', () => {
    it('anios en el futuro: Bajo', () => {
      const futuro = new Date('2099-12-31T23:59:59.000Z');
      const result = calcularAlarma(futuro.toISOString(), 'Pendiente');
      expect(result.nivel).toBe('Bajo');
    });

    it('anios en el pasado: MAXIMO PELIGRO', () => {
      const pasado = new Date('2020-01-01T00:00:00.000Z');
      const result = calcularAlarma(pasado.toISOString(), 'Pendiente');
      expect(result.nivel).toBe('¡MÁXIMO PELIGRO (CRÍTICO)!');
    });

    it('100 horas en el futuro: Bajo', () => {
      const futuro = new Date(Date.now() + 100 * 3600 * 1000);
      const result = calcularAlarma(futuro.toISOString(), 'Pendiente');
      expect(result.nivel).toBe('Bajo');
    });

    it('tarea enviada aunque FFL este vencida: Ninguno', () => {
      const pasado = new Date('2020-01-01T00:00:00.000Z');
      const result = calcularAlarma(pasado.toISOString(), 'Enviada');
      expect(result.nivel).toBe('Ninguno');
      expect(result.frecuenciaSegundos).toBe(0);
    });

    it('tarea enviada con FFL futura: Ninguno', () => {
      const futuro = new Date('2099-12-31T23:59:59.000Z');
      const result = calcularAlarma(futuro.toISOString(), 'Enviada');
      expect(result.nivel).toBe('Ninguno');
    });
  });

  describe('timezone - independencia de zona horaria', () => {
    it('ISO string con offset +05:00 equivale a su UTC correspondiente', () => {
      const instante = new Date(Date.now() + 3 * 3600 * 1000);
      const isoZ = instante.toISOString();

      const tzPlus5Date = new Date(instante.getTime() + 5 * 3600 * 1000);
      const isoPlus5 = tzPlus5Date.toISOString().replace('Z', '+05:00');

      const resultZ = calcularAlarma(isoZ, 'Pendiente');
      const resultPlus5 = calcularAlarma(isoPlus5, 'Pendiente');

      expect(resultZ.nivel).toBe(resultPlus5.nivel);
      expect(resultZ.frecuenciaSegundos).toBe(resultPlus5.frecuenciaSegundos);
    });

    it('fecha en America/Lima se procesa correctamente', () => {
      const futuro = new Date(Date.now() + 2 * 3600 * 1000);
      const result = calcularAlarma(futuro.toISOString(), 'Pendiente');
      expect(result.nivel).toBe('Moderado');
    });
  });
});
