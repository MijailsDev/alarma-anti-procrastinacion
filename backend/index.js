import express from 'express';
import Database from 'better-sqlite3';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppError, tryCatch, errorHandler } from './src/errors.js';
import { validate, registerSchema, loginSchema, createTaskSchema, updateEstadoSchema, updateConfigSchema, refreshSchema } from './src/validate.js';
import { ESTADOS, isValidTransition, calcularAlarma } from './src/logic.js';
import logger, { addRequestId, requestLogger } from './src/logger.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/alarma.db';
const JWT_SECRET = process.env.JWT_SECRET || 'alarma-anti-procrastinacion-secret-key-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN_MS = parseInt(process.env.REFRESH_EXPIRES_IN_MS || String(30 * 24 * 60 * 60 * 1000));

app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(addRequestId);
app.use(requestLogger);

const dbDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(DB_PATH));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.resolve(__dirname, '..', 'database', 'schema.sql');
if (fs.existsSync(schemaPath)) {
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  logger.info('Esquema de base de datos inicializado.');
}

logger.info({ db: DB_PATH }, 'Conexion a SQLite establecida.');

function toDBDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function fromDBDate(str) {
  const [datePart, timePart] = str.split(' ');
  return new Date(`${datePart}T${timePart}.000Z`);
}

// --- REFRESH TOKEN HELPERS ---

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

const insertRefreshTokenStmt = db.prepare('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)');
const findRefreshTokenStmt = db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > ?');
const deleteRefreshTokenStmt = db.prepare('DELETE FROM refresh_tokens WHERE token = ?');
const cleanupRefreshTokensStmt = db.prepare('DELETE FROM refresh_tokens WHERE expires_at <= ?');

function storeRefreshToken(userId, token) {
  const expiresAt = toDBDate(new Date(Date.now() + REFRESH_EXPIRES_IN_MS));
  insertRefreshTokenStmt.run(userId, token, expiresAt);
}

function findRefreshToken(token) {
  const row = findRefreshTokenStmt.get(token, toDBDate(new Date()));
  return row || null;
}

function deleteRefreshToken(token) {
  deleteRefreshTokenStmt.run(token);
}

setInterval(() => {
  try {
    const result = cleanupRefreshTokensStmt.run(toDBDate(new Date()));
    if (result.changes > 0) {
      logger.info({ count: result.changes }, 'Refresh tokens expirados limpiados');
    }
  } catch (err) {
    logger.error({ err }, 'Error limpiando refresh tokens');
  }
}, 3600000);

// --- MIDDLEWARE DE AUTENTICACION JWT ---

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticacion requerido.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuarioId = decoded.id;
    req.username = decoded.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado.' });
  }
}

// --- ENDPOINTS DE AUTENTICACION ---

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
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  const refreshToken = generateRefreshToken();
  storeRefreshToken(Number(result.lastInsertRowid), refreshToken);

  res.status(201).json({
    mensaje: 'Usuario registrado con exito.',
    token,
    refreshToken,
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
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  const refreshToken = generateRefreshToken();
  storeRefreshToken(user.id, refreshToken);

  res.json({
    mensaje: 'Inicio de sesion exitoso.',
    token,
    refreshToken,
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
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  const newRefreshToken = generateRefreshToken();
  storeRefreshToken(userId, newRefreshToken);

  res.json({
    token: newToken,
    refreshToken: newRefreshToken
  });
}));

// --- ENDPOINTS DE LA API (Protegidos) ---

app.get('/api/health', tryCatch(async (req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ status: 'ok', database: 'connected', timestamp: new Date() });
}));

app.get('/api/tareas', authenticateToken, tryCatch(async (req, res) => {
  const tareas = db.prepare('SELECT * FROM tareas WHERE usuario_id = ? ORDER BY fecha_limite_falsa ASC').all(req.usuarioId);

  const tareasConAlarmas = tareas.map(tarea => {
    const infoAlarma = calcularAlarma(fromDBDate(tarea.fecha_limite_falsa), tarea.estado);
    return { ...tarea, alarma: infoAlarma };
  });

  res.json(tareasConAlarmas);
}));

const createTareaStmt = db.prepare(
  `INSERT INTO tareas (usuario_id, titulo, descripcion, fecha_limite_real, fecha_limite_falsa, estado)
   VALUES (?, ?, ?, ?, ?, ?)`
);

app.post('/api/tareas', authenticateToken, validate(createTaskSchema), tryCatch(async (req, res) => {
  const { titulo, descripcion, fecha_limite_real } = req.validatedBody;
  const usuarioId = req.usuarioId;

  const user = db.prepare('SELECT margen_horas FROM usuarios WHERE id = ?').get(usuarioId);
  if (!user) {
    throw new AppError(404, 'Usuario no encontrado.');
  }

  const margenHoras = user.margen_horas;
  const fechaRealObj = new Date(fecha_limite_real);

  if (isNaN(fechaRealObj.getTime())) {
    throw new AppError(400, 'Formato de fecha limite real invalido.');
  }

  const fechaFalsaObj = new Date(fechaRealObj.getTime() - (margenHoras * 60 * 60 * 1000));
  const fRealStr = toDBDate(fechaRealObj);
  const fFalsaStr = toDBDate(fechaFalsaObj);

  const result = createTareaStmt.run(usuarioId, titulo, descripcion, fRealStr, fFalsaStr, ESTADOS.PENDIENTE);

  res.status(201).json({
    mensaje: 'Tarea creada con exito con Falsa Fecha Limite automatizada.',
    tareaId: Number(result.lastInsertRowid),
    titulo,
    fecha_limite_real: fRealStr,
    fecha_limite_falsa: fFalsaStr,
    margen_aplicado_horas: margenHoras,
    estado: ESTADOS.PENDIENTE
  });
}));

app.put('/api/tareas/:id/estado', authenticateToken, validate(updateEstadoSchema), tryCatch(async (req, res) => {
  const { id } = req.params;
  const { nuevoEstado } = req.validatedBody;

  const tarea = db.prepare('SELECT estado, titulo FROM tareas WHERE id = ? AND usuario_id = ?').get(id, req.usuarioId);
  if (!tarea) {
    throw new AppError(404, 'La tarea no existe.');
  }

  const estadoActual = tarea.estado;

  if (!isValidTransition(estadoActual, nuevoEstado)) {
    throw new AppError(400, `Transicion de estado denegada por la Maquina de Estados Estricta. Estado actual: ${estadoActual}, requerido siguiente: ${estadoActual === ESTADOS.PENDIENTE ? ESTADOS.EN_PROGRESO : ESTADOS.ENVIADA}, intentado: ${nuevoEstado}.`);
  }

  db.prepare('UPDATE tareas SET estado = ?, updated_at = ? WHERE id = ?').run(nuevoEstado, toDBDate(new Date()), id);

  res.json({
    mensaje: `Estado de la tarea '${tarea.titulo}' actualizado correctamente.`,
    id,
    estadoAnterior: estadoActual,
    estadoNuevo: nuevoEstado
  });
}));

app.get('/api/configuracion', authenticateToken, tryCatch(async (req, res) => {
  const user = db.prepare('SELECT margen_horas FROM usuarios WHERE id = ?').get(req.usuarioId);
  if (!user) {
    throw new AppError(404, 'Usuario no encontrado.');
  }
  res.json({ margen_horas: user.margen_horas });
}));

app.put('/api/configuracion', authenticateToken, validate(updateConfigSchema), tryCatch(async (req, res) => {
  const { margen_horas } = req.validatedBody;
  const usuarioId = req.usuarioId;

  db.prepare('UPDATE usuarios SET margen_horas = ? WHERE id = ?').run(margen_horas, usuarioId);

  const tareasToUpdate = db.prepare(
    'SELECT id, fecha_limite_real FROM tareas WHERE usuario_id = ? AND estado != ?'
  ).all(usuarioId, 'Enviada');

  const updateFFLStmt = db.prepare('UPDATE tareas SET fecha_limite_falsa = ?, updated_at = ? WHERE id = ?');
  for (const t of tareasToUpdate) {
    const realDate = fromDBDate(t.fecha_limite_real);
    const falsaDate = new Date(realDate.getTime() - margen_horas * 3600000);
    updateFFLStmt.run(toDBDate(falsaDate), toDBDate(new Date()), t.id);
  }

  res.json({
    mensaje: `Margen FFL actualizado a ${margen_horas} horas.`,
    margen_horas,
    tareas_actualizadas: tareasToUpdate.length
  });
}));

app.delete('/api/tareas/:id', authenticateToken, tryCatch(async (req, res) => {
  const { id } = req.params;

  const result = db.prepare('DELETE FROM tareas WHERE id = ? AND usuario_id = ?').run(id, req.usuarioId);
  if (result.changes === 0) {
    throw new AppError(404, 'La tarea no existe.');
  }
  res.json({ mensaje: `Tarea #${id} eliminada permanentemente.` });
}));

app.get('/api/alarmas', authenticateToken, tryCatch(async (req, res) => {
  const tareasActivas = db.prepare(
    'SELECT id, titulo, fecha_limite_falsa, estado FROM tareas WHERE usuario_id = ? AND estado != ?'
  ).all(req.usuarioId, ESTADOS.ENVIADA);

  const alarmasDisparadas = tareasActivas.map(tarea => {
    const alarmaInfo = calcularAlarma(fromDBDate(tarea.fecha_limite_falsa), tarea.estado);
    return {
      tareaId: tarea.id,
      titulo: tarea.titulo,
      estado: tarea.estado,
      fecha_limite_falsa: tarea.fecha_limite_falsa,
      alarma: alarmaInfo
    };
  });

  const maximaGravedad = alarmasDisparadas.reduce((max, curr) => {
    const jerarquia = { 'Ninguno': 0, 'Bajo': 1, 'Moderado': 2, 'Alto (Critico)': 3, 'MAXIMO PELIGRO (CRITICO)!': 4 };
    const valCurr = jerarquia[curr.alarma.nivel] || 0;
    const valMax = jerarquia[max.nivel] || 0;
    return valCurr > valMax ? curr.alarma : max;
  }, { nivel: 'Ninguno', frecuenciaSegundos: 0, mensaje: 'No hay alarmas activas.' });

  res.json({
    alertasActivas: alarmasDisparadas,
    alarmaCriticaDominante: maximaGravedad
  });
}));

// --- ANALYTICS / DASHBOARD ---

app.get('/api/analytics', authenticateToken, tryCatch(async (req, res) => {
  const userId = req.usuarioId;

  const totalRow = db.prepare('SELECT COUNT(*) as count FROM tareas WHERE usuario_id = ?').get(userId);
  const totalTareas = totalRow.count;

  const statusRows = db.prepare(
    'SELECT estado, COUNT(*) as count FROM tareas WHERE usuario_id = ? GROUP BY estado'
  ).all(userId);

  const getStatusCount = (estado) => {
    const row = statusRows.find(r => r.estado === estado);
    return row ? row.count : 0;
  };

  const completadas = db.prepare(
    `SELECT updated_at, fecha_limite_falsa, fecha_limite_real
     FROM tareas
     WHERE usuario_id = ? AND estado = 'Enviada'
     ORDER BY updated_at DESC`
  ).all(userId);

  let onTime = 0, lateFFL = 0, overdue = 0, streak = 0;
  let totalHoursEarly = 0;

  for (const t of completadas) {
    const completedAt = fromDBDate(t.updated_at);
    const ffl = fromDBDate(t.fecha_limite_falsa);
    const real = fromDBDate(t.fecha_limite_real);

    if (completedAt <= ffl) {
      onTime++;
      totalHoursEarly += (ffl - completedAt) / (1000 * 60 * 60);
    } else if (completedAt <= real) {
      lateFFL++;
    } else {
      overdue++;
    }
  }

  for (const t of completadas) {
    const completedAt = fromDBDate(t.updated_at);
    const ffl = fromDBDate(t.fecha_limite_falsa);
    if (completedAt <= ffl) streak++;
    else break;
  }

  const criticalRow = db.prepare(
    `SELECT COUNT(*) as count FROM tareas
     WHERE usuario_id = ? AND estado != 'Enviada'
     AND fecha_limite_falsa <= ?`
  ).get(userId, toDBDate(new Date(Date.now() + 3600000)));

  const tasaExito = completadas.length > 0 ? Math.round((onTime / completadas.length) * 100) : 0;

  res.json({
    totalTareas,
    totalCompletadas: completadas.length,
    onTime,
    lateFFL,
    overdue,
    pendientes: getStatusCount('Pendiente'),
    enProgreso: getStatusCount('En Progreso'),
    streak,
    promedioHorasAntes: onTime > 0 ? Math.round((totalHoursEarly / onTime) * 10) / 10 : 0,
    tareasCriticas: criticalRow.count,
    tasaExito
  });
}));

app.use(errorHandler);

// --- WORKER / CRON LIGERO ---

setInterval(() => {
  try {
    const tareasCriticas = db.prepare(
      `SELECT titulo, fecha_limite_falsa, estado FROM tareas
       WHERE estado != 'Enviada' AND fecha_limite_falsa <= ?`
    ).all(toDBDate(new Date()));

    if (tareasCriticas.length > 0) {
      logger.warn({ tareasCriticas: tareasCriticas.map(t => ({ titulo: t.titulo, estado: t.estado })) }, 'Tareas criticas detectadas por worker');
    }
  } catch (err) {
    logger.error({ err }, 'Error en el cron ligero del backend');
  }
}, 15000);

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Servidor de Alarma Anti-Procrastinacion iniciado');
});
