import { z } from 'zod';

export const registerSchema = z.object({
  username: z.string().trim().min(3, 'El usuario debe tener al menos 3 caracteres.').max(50).regex(/^[a-zA-Z0-9_]+$/, 'Solo letras, números y guión bajo.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.').max(100)
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Usuario requerido.'),
  password: z.string().min(1, 'Contraseña requerida.')
});

export const createTaskSchema = z.object({
  titulo: z.string().trim().min(1, 'El título es obligatorio.').max(200),
  descripcion: z.string().trim().max(2000, 'La descripción es muy larga.').optional().default(''),
  fecha_limite_real: z.string().refine(val => !isNaN(new Date(val).getTime()), 'Fecha límite real inválida.')
});

export const updateEstadoSchema = z.object({
  nuevoEstado: z.enum(['Pendiente', 'En Progreso', 'Enviada'], { errorMap: () => ({ message: 'Estado inválido.' }) })
});

export const updateConfigSchema = z.object({
  margen_horas: z.number({ errorMap: () => ({ message: 'El margen debe ser un número.' }) }).int().min(1, 'Mínimo 1 hora.').max(72, 'Máximo 72 horas.')
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token requerido.')
});

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      const firstError = Object.values(errors).flat()[0];
      return res.status(400).json({ error: firstError || 'Datos inválidos.' });
    }
    req.validatedBody = result.data;
    next();
  };
}
