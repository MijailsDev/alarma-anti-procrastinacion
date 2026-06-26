import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema, createTaskSchema, updateEstadoSchema, updateConfigSchema } from '../validate.js';

describe('registerSchema', () => {
  it('acepta credenciales validas', () => {
    const result = registerSchema.safeParse({ username: 'testuser', password: '123456' });
    expect(result.success).toBe(true);
  });

  it('rechaza username menor de 3 caracteres', () => {
    const result = registerSchema.safeParse({ username: 'ab', password: '123456' });
    expect(result.success).toBe(false);
  });

  it('rechaza username con caracteres especiales', () => {
    const result = registerSchema.safeParse({ username: 'user name!', password: '123456' });
    expect(result.success).toBe(false);
  });

  it('rechaza password menor de 6 caracteres', () => {
    const result = registerSchema.safeParse({ username: 'testuser', password: '12345' });
    expect(result.success).toBe(false);
  });

  it('limpia espacios del username', () => {
    const result = registerSchema.safeParse({ username: '  testuser  ', password: '123456' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe('testuser');
    }
  });
});

describe('loginSchema', () => {
  it('acepta credenciales validas', () => {
    const result = loginSchema.safeParse({ username: 'testuser', password: 'anypass' });
    expect(result.success).toBe(true);
  });

  it('rechaza username vacio', () => {
    const result = loginSchema.safeParse({ username: '', password: 'anypass' });
    expect(result.success).toBe(false);
  });

  it('rechaza password vacio', () => {
    const result = loginSchema.safeParse({ username: 'testuser', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('createTaskSchema', () => {
  it('acepta tarea valida', () => {
    const result = createTaskSchema.safeParse({
      titulo: 'Mi tarea',
      fecha_limite_real: '2026-12-31T23:59:00.000Z'
    });
    expect(result.success).toBe(true);
  });

  it('rechaza titulo vacio', () => {
    const result = createTaskSchema.safeParse({
      titulo: '',
      fecha_limite_real: '2026-12-31T23:59:00.000Z'
    });
    expect(result.success).toBe(false);
  });

  it('rechaza fecha invalida', () => {
    const result = createTaskSchema.safeParse({
      titulo: 'Tarea',
      fecha_limite_real: 'no-es-una-fecha'
    });
    expect(result.success).toBe(false);
  });

  it('descripcion por defecto es string vacio', () => {
    const result = createTaskSchema.safeParse({
      titulo: 'Tarea',
      fecha_limite_real: '2026-12-31T23:59:00.000Z'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.descripcion).toBe('');
    }
  });

  it('rechaza titulo mayor a 200 caracteres', () => {
    const result = createTaskSchema.safeParse({
      titulo: 'x'.repeat(201),
      fecha_limite_real: '2026-12-31T23:59:00.000Z'
    });
    expect(result.success).toBe(false);
  });
});

describe('updateEstadoSchema', () => {
  it('acepta estados validos', () => {
    for (const estado of ['Pendiente', 'En Progreso', 'Enviada']) {
      const result = updateEstadoSchema.safeParse({ nuevoEstado: estado });
      expect(result.success).toBe(true);
    }
  });

  it('rechaza estado invalido', () => {
    const result = updateEstadoSchema.safeParse({ nuevoEstado: 'Invalido' });
    expect(result.success).toBe(false);
  });
});

describe('updateConfigSchema', () => {
  it('acepta margen valido', () => {
    const result = updateConfigSchema.safeParse({ margen_horas: 5 });
    expect(result.success).toBe(true);
  });

  it('rechaza margen menor a 1', () => {
    const result = updateConfigSchema.safeParse({ margen_horas: 0 });
    expect(result.success).toBe(false);
  });

  it('rechaza margen mayor a 72', () => {
    const result = updateConfigSchema.safeParse({ margen_horas: 73 });
    expect(result.success).toBe(false);
  });

  it('rechaza valor no entero', () => {
    const result = updateConfigSchema.safeParse({ margen_horas: 5.5 });
    expect(result.success).toBe(false);
  });

  it('rechaza string', () => {
    const result = updateConfigSchema.safeParse({ margen_horas: '5' });
    expect(result.success).toBe(false);
  });
});
