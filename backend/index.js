import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AppError, tryCatch, errorHandler } from './src/errors.js';
import { validate, registerSchema, loginSchema, createTaskSchema, updateEstadoSchema, updateConfigSchema, refreshSchema } from './src/validate.js';
import { ESTADOS, isValidTransition, calcularAlarma } from './src/logic.js';
import logger, { addRequestId, requestLogger } from './src/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'alarma-anti-procrastinacion-secret-key-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN_MS = parseInt(process.env.REFRESH_EXPIRES_IN_MS || String(30 * 24 * 60 * 60 * 1000));

app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(addRequestId);
app.use(requestLogger);

const dbConfig = {
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'alarma_user',
  password: process.env.DB_PASSWORD || 'alarma_pass_sec_2026',
  database: process.env.DB_NAME || 'alarma_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
};

let pool;

async function connectDatabase() {
  let attempts = 5;
  while (attempts) {
    try {
      pool = mysql.createPool(dbConfig);
      const connection = await pool.getConnection();
      logger.info('Conexion exitosa a la base de datos MySQL.');
      connection.release();
      break;
    } catch (err) {
      logger.error({ err }, `Error conectando a MySQL (Intentos restantes: ${attempts - 1})`);
      attempts -= 1;
      if (attempts === 0) {
        logger.fatal('No se pudo establecer conexion con la base de datos. Saliendo...');
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

await connectDatabase();

// --- REFRESH TOKEN HELPERS ---

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

async function storeRefreshToken(userId, token) {
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_IN_MS);
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [userId, token, expiresAt]
  );
}

async function findRefreshToken(token) {
  const [rows] = await pool.query(
    'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW()',
    [token]
  );
  return rows[0] || null;
}

async function deleteRefreshToken(token) {
  await pool.query('DELETE FROM refresh_tokens WHERE token = ?', [token]);
}

setInterval(async () => {
  try {
    if (pool) {
      const [result] = await pool.query('DELETE FROM refresh_tokens WHERE expires_at <= NOW()');
      if (result.affectedRows > 0) {
        logger.info({ count: result.affectedRows }, 'Refresh tokens expirados limpiados');
      }
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

  const [existing] = await pool.query('SELECT id FROM usuarios WHERE username = ?', [username]);
  if (existing.length > 0) {
    throw new AppError(409, 'El nombre de usuario ya existe.');
  }

  const email = `${username}@alarma.app`;
  const passwordHash = await bcrypt.hash(password, 10);

  const [result] = await pool.query(
    'INSERT INTO usuarios (username, email, password_hash) VALUES (?, ?, ?)',
    [username, email, passwordHash]
  );

  const token = jwt.sign(
    { id: result.insertId, username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  const refreshToken = generateRefreshToken();
  await storeRefreshToken(result.insertId, refreshToken);

  res.status(201).json({
    mensaje: 'Usuario registrado con exito.',
    token,
    refreshToken,
    user: { id: result.insertId, username }
  });
}));

app.post('/api/login', validate(loginSchema), tryCatch(async (req, res) => {
  const { username, password } = req.validatedBody;

  const [usuarios] = await pool.query(
    'SELECT id, username, password_hash FROM usuarios WHERE username = ?',
    [username]
  );

  if (usuarios.length === 0) {
    throw new AppError(401, 'Credenciales invalidas.');
  }

  const user = usuarios[0];
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
  await storeRefreshToken(user.id, refreshToken);

  res.json({
    mensaje: 'Inicio de sesion exitoso.',
    token,
    refreshToken,
    user: { id: user.id, username: user.username }
  });
}));

app.post('/api/refresh-token', validate(refreshSchema), tryCatch(async (req, res) => {
  const { refreshToken } = req.validatedBody;

  const stored = await findRefreshToken(refreshToken);
  if (!stored) {
    throw new AppError(401, 'Refresh token invalido o expirado.');
  }

  await deleteRefreshToken(refreshToken);

  const userId = stored.user_id;

  const [usuarios] = await pool.query('SELECT username FROM usuarios WHERE id = ?', [userId]);
  if (usuarios.length === 0) {
    throw new AppError(401, 'Usuario no encontrado.');
  }

  const newToken = jwt.sign(
    { id: userId, username: usuarios[0].username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  const newRefreshToken = generateRefreshToken();
  await storeRefreshToken(userId, newRefreshToken);

  res.json({
    token: newToken,
    refreshToken: newRefreshToken
  });
}));

// --- ENDPOINTS DE LA API (Protegidos) ---

app.get('/api/health', tryCatch(async (req, res) => {
  const [result] = await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected', timestamp: new Date() });
}));

app.get('/api/tareas', authenticateToken, tryCatch(async (req, res) => {
  const [tareas] = await pool.query(
    'SELECT * FROM tareas WHERE usuario_id = ? ORDER BY fecha_limite_falsa ASC',
    [req.usuarioId]
  );

  const tareasConAlarmas = tareas.map(tarea => {
    const infoAlarma = calcularAlarma(tarea.fecha_limite_falsa, tarea.estado);
    return { ...tarea, alarma: infoAlarma };
  });

  res.json(tareasConAlarmas);
}));

app.post('/api/tareas', authenticateToken, validate(createTaskSchema), tryCatch(async (req, res) => {
  const { titulo, descripcion, fecha_limite_real } = req.validatedBody;
  const usuarioId = req.usuarioId;

  const [usuarios] = await pool.query('SELECT margen_horas FROM usuarios WHERE id = ?', [usuarioId]);
  if (usuarios.length === 0) {
    throw new AppError(404, 'Usuario no encontrado.');
  }

  const margenHoras = usuarios[0].margen_horas;
  const fechaRealObj = new Date(fecha_limite_real);

  if (isNaN(fechaRealObj.getTime())) {
    throw new AppError(400, 'Formato de fecha limite real invalido.');
  }

  const fechaFalsaObj = new Date(fechaRealObj.getTime() - (margenHoras * 60 * 60 * 1000));
  const formatMySQLDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
  const fRealStr = formatMySQLDate(fechaRealObj);
  const fFalsaStr = formatMySQLDate(fechaFalsaObj);

  const [result] = await pool.query(
    `INSERT INTO tareas (usuario_id, titulo, descripcion, fecha_limite_real, fecha_limite_falsa, estado)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [usuarioId, titulo, descripcion, fRealStr, fFalsaStr, ESTADOS.PENDIENTE]
  );

  res.status(201).json({
    mensaje: 'Tarea creada con exito con Falsa Fecha Limite automatizada.',
    tareaId: result.insertId,
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

  const [tareas] = await pool.query(
    'SELECT estado, titulo FROM tareas WHERE id = ? AND usuario_id = ?',
    [id, req.usuarioId]
  );
  if (tareas.length === 0) {
    throw new AppError(404, 'La tarea no existe.');
  }

  const estadoActual = tareas[0].estado;

  if (!isValidTransition(estadoActual, nuevoEstado)) {
    throw new AppError(400, `Transicion de estado denegada por la Maquina de Estados Estricta. Estado actual: ${estadoActual}, requerido siguiente: ${estadoActual === ESTADOS.PENDIENTE ? ESTADOS.EN_PROGRESO : ESTADOS.ENVIADA}, intentado: ${nuevoEstado}.`);
  }

  await pool.query('UPDATE tareas SET estado = ? WHERE id = ?', [nuevoEstado, id]);

  res.json({
    mensaje: `Estado de la tarea '${tareas[0].titulo}' actualizado correctamente.`,
    id,
    estadoAnterior: estadoActual,
    estadoNuevo: nuevoEstado
  });
}));

app.get('/api/configuracion', authenticateToken, tryCatch(async (req, res) => {
  const [usuarios] = await pool.query('SELECT margen_horas FROM usuarios WHERE id = ?', [req.usuarioId]);
  if (usuarios.length === 0) {
    throw new AppError(404, 'Usuario no encontrado.');
  }
  res.json({ margen_horas: usuarios[0].margen_horas });
}));

app.put('/api/configuracion', authenticateToken, validate(updateConfigSchema), tryCatch(async (req, res) => {
  const { margen_horas } = req.validatedBody;
  const usuarioId = req.usuarioId;

  await pool.query('UPDATE usuarios SET margen_horas = ? WHERE id = ?', [margen_horas, usuarioId]);

  const [result] = await pool.query(
    `UPDATE tareas SET fecha_limite_falsa = DATE_SUB(fecha_limite_real, INTERVAL ? HOUR)
     WHERE usuario_id = ? AND estado != 'Enviada'`,
    [margen_horas, usuarioId]
  );

  res.json({
    mensaje: `Margen FFL actualizado a ${margen_horas} horas.`,
    margen_horas,
    tareas_actualizadas: result.affectedRows
  });
}));

app.delete('/api/tareas/:id', authenticateToken, tryCatch(async (req, res) => {
  const { id } = req.params;

  const [result] = await pool.query('DELETE FROM tareas WHERE id = ? AND usuario_id = ?', [id, req.usuarioId]);
  if (result.affectedRows === 0) {
    throw new AppError(404, 'La tarea no existe.');
  }
  res.json({ mensaje: `Tarea #${id} eliminada permanentemente.` });
}));

app.get('/api/alarmas', authenticateToken, tryCatch(async (req, res) => {
  const [tareasActivas] = await pool.query(
    'SELECT id, titulo, fecha_limite_falsa, estado FROM tareas WHERE usuario_id = ? AND estado != ?',
    [req.usuarioId, ESTADOS.ENVIADA]
  );

  const alarmasDisparadas = tareasActivas.map(tarea => {
    const alarmaInfo = calcularAlarma(tarea.fecha_limite_falsa, tarea.estado);
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

app.use(errorHandler);

// --- WORKER / CRON LIGERO ---

setInterval(async () => {
  try {
    if (pool) {
      const [tareasCriticas] = await pool.query(
        `SELECT titulo, fecha_limite_falsa, estado FROM tareas
         WHERE estado != 'Enviada' AND fecha_limite_falsa <= NOW()`
      );
      if (tareasCriticas.length > 0) {
        logger.warn({ tareasCriticas: tareasCriticas.map(t => ({ titulo: t.titulo, estado: t.estado })) }, 'Tareas criticas detectadas por worker');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error en el cron ligero del backend');
  }
}, 15000);

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Servidor de Alarma Anti-Procrastinacion iniciado');
});
