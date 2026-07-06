import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppError, tryCatch, errorHandler } from './src/errors.js';
import { validate, registerSchema, loginSchema, createTaskSchema, updateEstadoSchema, updateConfigSchema, refreshSchema } from './src/validate.js';
import { ESTADOS, isValidTransition, calcularAlarma } from './src/logic.js';
import logger, { addRequestId, requestLogger } from './src/logger.js';
import { createDatabase } from './src/database.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
let db;
let server;

function toDBDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function fromDBDate(str) {
  const [datePart, timePart] = str.split(' ');
  return new Date(`${datePart}T${timePart}.000Z`);
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token de autenticacion requerido.' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'alarma-anti-procrastinacion-secret-key-2026');
    req.usuarioId = decoded.id;
    req.username = decoded.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado.' });
  }
}

app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(addRequestId);
app.use(requestLogger);

function setupRoutes() {
  app.post('/api/register', validate(registerSchema), tryCatch(async (req, res) => {
    const { username, password } = req.validatedBody;
    const existing = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username);
    if (existing) {
      throw new AppError(409, 'El nombre de usuario ya existe.');
    }
    const email = `${username}@alarma.app`;
    const passwordHash = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO usuarios (username, email, password_hash) VALUES (?, ?, ?)').run(username, email, passwordHash);
    const token = jwt.sign(
      { id: Number(result.lastInsertRowid), username },
      process.env.JWT_SECRET || 'alarma-anti-procrastinacion-secret-key-2026',
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );
    const refreshToken = generateRefreshToken();
    storeRefreshToken(Number(result.lastInsertRowid), refreshToken);
    res.status(201).json({
      mensaje: 'Usuario registrado con exito.',
      token, refreshToken,
      user: { id: Number(result.lastInsertRowid), username }
    });
  }));

  app.post('/api/login', validate(loginSchema), tryCatch(async (req, res) => {
    const { username, password } = req.validatedBody;
    const user = db.prepare('SELECT id, username, password_hash FROM usuarios WHERE username = ?').get(username);
    if (!user) {
      throw new AppError(401, 'Credenciales invalidas.');
    }
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      throw new AppError(401, 'Credenciales invalidas.');
    }
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || 'alarma-anti-procrastinacion-secret-key-2026',
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );
    const refreshToken = generateRefreshToken();
    storeRefreshToken(user.id, refreshToken);
    res.json({
      mensaje: 'Inicio de sesion exitoso.',
      token, refreshToken,
      user: { id: user.id, username: user.username }
    });
  }));

  app.post('/api/refresh-token', validate(refreshSchema), tryCatch(async (req, res) => {
    const { refreshToken } = req.validatedBody;
    const stored = findRefreshToken(refreshToken);
    if (!stored) {
      throw new AppError(401, 'Refresh token invalido o expirado.');
    }
    deleteRefreshToken(refreshToken);
    const userId = stored.user_id;
    const user = db.prepare('SELECT username FROM usuarios WHERE id = ?').get(userId);
    if (!user) {
      throw new AppError(401, 'Usuario no encontrado.');
    }
    const newToken = jwt.sign(
      { id: userId, username: user.username },
      process.env.JWT_SECRET || 'alarma-anti-procrastinacion-secret-key-2026',
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );
    const newRefreshToken = generateRefreshToken();
    storeRefreshToken(userId, newRefreshToken);
    res.json({ token: newToken, refreshToken: newRefreshToken });
  }));

  app.get('/api/health', tryCatch(async (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', database: 'connected', timestamp: new Date() });
  }));

  app.get('/api/tareas', authenticateToken, tryCatch(async (req, res) => {
    const tareas = db.prepare('SELECT * FROM tareas WHERE usuario_id = ? ORDER BY fecha_limite_falsa ASC').all(req.usuarioId);
    res.json(tareas.map(t => ({ ...t, alarma: calcularAlarma(fromDBDate(t.fecha_limite_falsa), t.estado) })));
  }));

  app.post('/api/tareas', authenticateToken, validate(createTaskSchema), tryCatch(async (req, res) => {
    const { titulo, descripcion, fecha_limite_real } = req.validatedBody;
    const usuarioId = req.usuarioId;
    const user = db.prepare('SELECT margen_horas FROM usuarios WHERE id = ?').get(usuarioId);
    if (!user) throw new AppError(404, 'Usuario no encontrado.');
    const fechaRealObj = new Date(fecha_limite_real);
    if (isNaN(fechaRealObj.getTime())) throw new AppError(400, 'Formato de fecha limite real invalido.');
    const margenHoras = user.margen_horas;
    const fechaFalsaObj = new Date(fechaRealObj.getTime() - (margenHoras * 60 * 60 * 1000));
    const fRealStr = toDBDate(fechaRealObj);
    const fFalsaStr = toDBDate(fechaFalsaObj);
    const result = db.prepare(
      'INSERT INTO tareas (usuario_id, titulo, descripcion, fecha_limite_real, fecha_limite_falsa, estado) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(usuarioId, titulo, descripcion, fRealStr, fFalsaStr, ESTADOS.PENDIENTE);
    res.status(201).json({
      mensaje: 'Tarea creada con exito con Falsa Fecha Limite automatizada.',
      tareaId: Number(result.lastInsertRowid), titulo,
      fecha_limite_real: fRealStr, fecha_limite_falsa: fFalsaStr,
      margen_aplicado_horas: margenHoras, estado: ESTADOS.PENDIENTE
    });
  }));

  app.put('/api/tareas/:id/estado', authenticateToken, validate(updateEstadoSchema), tryCatch(async (req, res) => {
    const { id } = req.params;
    const { nuevoEstado } = req.validatedBody;
    const tarea = db.prepare('SELECT estado, titulo FROM tareas WHERE id = ? AND usuario_id = ?').get(id, req.usuarioId);
    if (!tarea) throw new AppError(404, 'La tarea no existe.');
    if (!isValidTransition(tarea.estado, nuevoEstado)) {
      throw new AppError(400, `Transicion de estado denegada. Estado actual: ${tarea.estado}`);
    }
    db.prepare('UPDATE tareas SET estado = ?, updated_at = ? WHERE id = ?').run(nuevoEstado, toDBDate(new Date()), id);
    res.json({ mensaje: `Estado de la tarea '${tarea.titulo}' actualizado correctamente.`, id, estadoAnterior: tarea.estado, estadoNuevo: nuevoEstado });
  }));

  app.get('/api/configuracion', authenticateToken, tryCatch(async (req, res) => {
    const user = db.prepare('SELECT margen_horas FROM usuarios WHERE id = ?').get(req.usuarioId);
    if (!user) throw new AppError(404, 'Usuario no encontrado.');
    res.json({ margen_horas: user.margen_horas });
  }));

  app.put('/api/configuracion', authenticateToken, validate(updateConfigSchema), tryCatch(async (req, res) => {
    const { margen_horas } = req.validatedBody;
    const usuarioId = req.usuarioId;
    db.prepare('UPDATE usuarios SET margen_horas = ? WHERE id = ?').run(margen_horas, usuarioId);
    const tareasToUpdate = db.prepare(
      'SELECT id, fecha_limite_real FROM tareas WHERE usuario_id = ? AND estado != ?'
    ).all(usuarioId, 'Enviada');
    for (const t of tareasToUpdate) {
      const falsaDate = new Date(fromDBDate(t.fecha_limite_real).getTime() - margen_horas * 3600000);
      db.prepare('UPDATE tareas SET fecha_limite_falsa = ?, updated_at = ? WHERE id = ?').run(toDBDate(falsaDate), toDBDate(new Date()), t.id);
    }
    res.json({ mensaje: `Margen FFL actualizado a ${margen_horas} horas.`, margen_horas, tareas_actualizadas: tareasToUpdate.length });
  }));

  app.delete('/api/tareas/:id', authenticateToken, tryCatch(async (req, res) => {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM tareas WHERE id = ? AND usuario_id = ?').run(id, req.usuarioId);
    if (result.changes === 0) throw new AppError(404, 'La tarea no existe.');
    res.json({ mensaje: `Tarea #${id} eliminada permanentemente.` });
  }));

  app.get('/api/alarmas', authenticateToken, tryCatch(async (req, res) => {
    const tareas = db.prepare(
      'SELECT id, titulo, fecha_limite_falsa, estado FROM tareas WHERE usuario_id = ? AND estado != ?'
    ).all(req.usuarioId, ESTADOS.ENVIADA);
    const alertas = tareas.map(t => ({ tareaId: t.id, titulo: t.titulo, estado: t.estado, fecha_limite_falsa: t.fecha_limite_falsa, alarma: calcularAlarma(fromDBDate(t.fecha_limite_falsa), t.estado) }));
    const jerarquia = { 'Ninguno': 0, 'Bajo': 1, 'Moderado': 2, 'Alto (Critico)': 3, 'MAXIMO PELIGRO (CRITICO)!': 4 };
    const maxima = alertas.reduce((max, a) => (jerarquia[a.alarma.nivel] || 0) > (jerarquia[max.nivel] || 0) ? a.alarma : max, { nivel: 'Ninguno' });
    res.json({ alertasActivas: alertas, alarmaCriticaDominante: maxima });
  }));

  app.get('/api/analytics', authenticateToken, tryCatch(async (req, res) => {
    const userId = req.usuarioId;
    const totalRow = db.prepare('SELECT COUNT(*) as count FROM tareas WHERE usuario_id = ?').get(userId);
    const totalTareas = totalRow.count;
    const statusRows = db.prepare('SELECT estado, COUNT(*) as count FROM tareas WHERE usuario_id = ? GROUP BY estado').all(userId);
    const getStatusCount = (estado) => { const r = statusRows.find(r => r.estado === estado); return r ? r.count : 0; };
    const completadas = db.prepare(
      'SELECT updated_at, fecha_limite_falsa, fecha_limite_real FROM tareas WHERE usuario_id = ? AND estado = \'Enviada\' ORDER BY updated_at DESC'
    ).all(userId);
    let onTime = 0, lateFFL = 0, overdue = 0, streak = 0, totalHoursEarly = 0;
    for (const t of completadas) {
      const ca = fromDBDate(t.updated_at), ff = fromDBDate(t.fecha_limite_falsa), rl = fromDBDate(t.fecha_limite_real);
      if (ca <= ff) { onTime++; totalHoursEarly += (ff - ca) / (1000 * 60 * 60); }
      else if (ca <= rl) lateFFL++;
      else overdue++;
    }
    for (const t of completadas) {
      if (fromDBDate(t.updated_at) <= fromDBDate(t.fecha_limite_falsa)) streak++; else break;
    }
    const criticalRow = db.prepare(
      'SELECT COUNT(*) as count FROM tareas WHERE usuario_id = ? AND estado != \'Enviada\' AND fecha_limite_falsa <= ?'
    ).get(userId, toDBDate(new Date(Date.now() + 3600000)));
    res.json({
      totalTareas, totalCompletadas: completadas.length, onTime, lateFFL, overdue,
      pendientes: getStatusCount('Pendiente'), enProgreso: getStatusCount('En Progreso'),
      streak, promedioHorasAntes: onTime > 0 ? Math.round((totalHoursEarly / onTime) * 10) / 10 : 0,
      tareasCriticas: criticalRow.count,
      tasaExito: completadas.length > 0 ? Math.round((onTime / completadas.length) * 100) : 0
    });
  }));

  app.use(errorHandler);
}

function storeRefreshToken(userId, token) {
  const expiresAt = toDBDate(new Date(Date.now() + parseInt(process.env.REFRESH_EXPIRES_IN_MS || String(30 * 24 * 60 * 60 * 1000))));
  db.prepare('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)').run(userId, token, expiresAt);
}

function findRefreshToken(token) {
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > ?').get(token, toDBDate(new Date()));
  return row || null;
}

function deleteRefreshToken(token) {
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(token);
}

setInterval(() => {
  try {
    const result = db.prepare('DELETE FROM refresh_tokens WHERE expires_at <= ?').run(toDBDate(new Date()));
    if (result.changes > 0) {
      logger.info({ count: result.changes }, 'Refresh tokens expirados limpiados');
    }
  } catch (err) {
    logger.error({ err }, 'Error limpiando refresh tokens');
  }
}, 3600000);

setInterval(() => {
  try {
    const tareasCriticas = db.prepare(
      'SELECT titulo, fecha_limite_falsa, estado FROM tareas WHERE estado != \'Enviada\' AND fecha_limite_falsa <= ?'
    ).all(toDBDate(new Date()));
    if (tareasCriticas.length > 0) {
      logger.warn({ tareasCriticas: tareasCriticas.map(t => ({ titulo: t.titulo, estado: t.estado })) }, 'Tareas criticas detectadas por worker');
    }
  } catch (err) {
    logger.error({ err }, 'Error en el cron ligero del backend');
  }
}, 15000);

export async function startServer(options = {}) {
  const port = options.port || process.env.PORT || 3000;
  const dbPath = options.dbPath || process.env.DB_PATH || './data/alarma.db';
  const jwtSecret = options.jwtSecret || process.env.JWT_SECRET || 'alarma-anti-procrastinacion-secret-key-2026';
  const logLevel = options.logLevel || process.env.LOG_LEVEL || 'info';

  process.env.JWT_SECRET = jwtSecret;
  process.env.LOG_LEVEL = logLevel;

  db = await createDatabase(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.resolve(__dirname, '..', 'database', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
    logger.info('Esquema de base de datos inicializado.');
  }

  logger.info({ db: dbPath }, 'Conexion a SQLite establecida.');

  setupRoutes();

  return new Promise((resolve, reject) => {
    server = app.listen(port, () => {
      logger.info({ port }, 'Servidor de Alarma Anti-Procrastinacion iniciado');
      logger.info({ db: dbPath, mode: process.env.NODE_ENV || 'development' }, 'Backend listo');
      resolve(server);
    });
    server.on('error', reject);
  });
}

export function stopServer() {
  if (server) {
    server.close();
    server = null;
  }
  if (db && db.open) {
    try { db.close(); } catch {}
    db = null;
  }
}

const isMainModule = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
);

if (isMainModule) {
  startServer().catch(err => {
    logger.error({ err }, 'Error al iniciar el servidor');
    process.exit(1);
  });

  process.on('exit', () => {
    if (db && db.open) {
      try { db.close(); } catch {}
    }
  });

  process.on('SIGTERM', () => {
    stopServer();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    stopServer();
    process.exit(0);
  });
}
