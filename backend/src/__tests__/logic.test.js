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
    expect(result.nivel).toBe('Alto (Critico)');
    expect(result.frecuenciaSegundos).toBe(60);
  });

  it('retorna "MAXIMO PELIGRO (CRITICO)!" cuando la FFL ya vencio', () => {
    const pasado = new Date(Date.now() - 60 * 60 * 1000);
    const result = calcularAlarma(pasado.toISOString(), 'Pendiente');
    expect(result.nivel).toBe('MAXIMO PELIGRO (CRITICO)!');
    expect(result.frecuenciaSegundos).toBe(5);
  });

  it('retorna "MAXIMO PELIGRO" incluso si estado es "En Progreso" pero vencido', () => {
    const pasado = new Date(Date.now() - 10 * 60 * 1000);
    const result = calcularAlarma(pasado.toISOString(), 'En Progreso');
    expect(result.nivel).toBe('MAXIMO PELIGRO (CRITICO)!');
  });

  it('usa la fecha actual para el calculo', () => {
    const casiVencido = new Date(Date.now() + 2 * 3600 * 1000);
    const result = calcularAlarma(casiVencido.toISOString(), 'Pendiente');
    expect(result.nivel).toBe('Moderado');
  });
});
