import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'alarma-anti-procrastinacion-secret-key-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

app.use(cors());
app.use(express.json());

// Configuración del Pool de Conexión a MySQL
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

// Función para inicializar y validar la conexión a la base de datos
async function connectDatabase() {
  let attempts = 5;
  while (attempts) {
    try {
      pool = mysql.createPool(dbConfig);
      // Validar conexión haciendo un ping
      const connection = await pool.getConnection();
      console.log('✅ Conexión exitosa a la base de datos MySQL.');
      connection.release();
      break;
    } catch (err) {
      console.error(`❌ Error conectando a MySQL (Intentos restantes: ${attempts - 1}):`, err.message);
      attempts -= 1;
      if (attempts === 0) {
        console.error('💥 No se pudo establecer conexión con la base de datos. Saliendo...');
        process.exit(1);
      }
      // Esperar 5 segundos antes de reintentar (útil mientras MySQL inicializa)
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Inicializar base de datos al arrancar
await connectDatabase();

// --- MIDDLEWARE DE AUTENTICACIÓN JWT ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticación requerido.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuarioId = decoded.id;
    req.username = decoded.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

// --- LÓGICA DE NEGOCIO: MÁQUINA DE ESTADOS Y CÁLCULO DE ALARMAS ---

const ESTADOS = {
  PENDIENTE: 'Pendiente',
  EN_PROGRESO: 'En Progreso',
  ENVIADA: 'Enviada'
};

// Validar transición estricta de la máquina de estados:
// Pendiente -> En Progreso -> Enviada
function isValidTransition(estadoActual, estadoNuevo) {
  if (estadoActual === ESTADOS.PENDIENTE && estadoNuevo === ESTADOS.EN_PROGRESO) return true;
  if (estadoActual === ESTADOS.EN_PROGRESO && estadoNuevo === ESTADOS.ENVIADA) return true;
  // Permitir la transición directa de Pendiente a Enviada en caso extremo,
  // pero mantengamos la regla estricta: Pendiente -> En Progreso -> Enviada
  return false;
}

// Calcular nivel de alarma y frecuencia de disparo basada en la FFL (Falsa Fecha Límite)
function calcularAlarma(fechaLimiteFalsa, estado) {
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
      color: '#28a745', // Verde
      frecuenciaSegundos: 3600, // Cada 1 hora
      mensaje: 'Tranquilo, estás a buen tiempo respecto a tu Falsa Fecha Límite.'
    };
  } else if (diferenciaHoras > 1 && diferenciaHoras <= 5) {
    return {
      nivel: 'Moderado',
      color: '#ffc107', // Amarillo
      frecuenciaSegundos: 900, // Cada 15 minutos
      mensaje: '¡Atención! La Falsa Fecha Límite se acerca. Empieza a avanzar.'
    };
  } else if (diferenciaHoras > 0 && diferenciaHoras <= 1) {
    return {
      nivel: 'Alto (Crítico)',
      color: '#fd7e14', // Naranja
      frecuenciaSegundos: 60, // Cada 1 minuto
      mensaje: '⚠️ ¡URGENTE! Te queda menos de 1 hora para tu Falsa Fecha Límite.'
    };
  } else {
    // Vencida la FFL pero el estado NO es 'Enviada'
    return {
      nivel: '¡MÁXIMO PELIGRO (CRÍTICO)!',
      color: '#dc3545', // Rojo intermitente
      frecuenciaSegundos: 5, // Cada 5 segundos (Zumbido insistente)
      mensaje: '🚨 ¡ALERTA AGRESIVA! Has superado tu Falsa Fecha Límite y la tarea NO ha sido enviada. ¡ENTREGA YA!'
    };
  }
}

// --- ENDPOINTS DE AUTENTICACIÓN ---

// Registro de nuevo usuario
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  try {
    const [existing] = await pool.query('SELECT id FROM usuarios WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'El nombre de usuario ya existe.' });
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

    res.status(201).json({
      mensaje: 'Usuario registrado con éxito.',
      token,
      user: { id: result.insertId, username }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar usuario', detalles: err.message });
  }
});

// Inicio de sesión
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  try {
    const [usuarios] = await pool.query(
      'SELECT id, username, password_hash FROM usuarios WHERE username = ?',
      [username]
    );

    if (usuarios.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const user = usuarios[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      mensaje: 'Inicio de sesión exitoso.',
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión', detalles: err.message });
  }
});

// --- ENDPOINTS DE LA API (Protegidos) ---

// 1. Endpoint de Salud (Health Check)
app.get('/api/health', async (req, res) => {
  try {
    const [result] = await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 2. Obtener todas las tareas del usuario autenticado con sus alarmas dinámicas calculadas en tiempo real
app.get('/api/tareas', authenticateToken, async (req, res) => {
  try {
    const [tareas] = await pool.query('SELECT * FROM tareas WHERE usuario_id = ? ORDER BY fecha_limite_falsa ASC', [req.usuarioId]);

    // Enriquecer tareas con la lógica de alarmas en tiempo real
    const tareasConAlarmas = tareas.map(tarea => {
      const infoAlarma = calcularAlarma(tarea.fecha_limite_falsa, tarea.estado);
      return {
        ...tarea,
        alarma: infoAlarma
      };
    });

    res.json(tareasConAlarmas);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener las tareas', detalles: err.message });
  }
});

// 3. Crear una nueva tarea con cálculo automático de Falsa Fecha Límite (FFL)
app.post('/api/tareas', authenticateToken, async (req, res) => {
  const { titulo, descripcion, fecha_limite_real } = req.body;
  const usuarioId = req.usuarioId;

  if (!titulo || !fecha_limite_real) {
    return res.status(400).json({ error: 'El título y la fecha límite real son obligatorios.' });
  }

  try {
    // Obtener el margen de horas configurado para el usuario
    const [usuarios] = await pool.query('SELECT margen_horas FROM usuarios WHERE id = ?', [usuarioId]);
    if (usuarios.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    const margenHoras = usuarios[0].margen_horas;

    // Calcular la FFL (Restar margen_horas a la fecha_limite_real)
    const fechaRealObj = new Date(fecha_limite_real);
    if (isNaN(fechaRealObj.getTime())) {
      return res.status(400).json({ error: 'Formato de fecha límite real inválido.' });
    }

    const fechaFalsaObj = new Date(fechaRealObj.getTime() - (margenHoras * 60 * 60 * 1000));

    // Formatear fechas para insertar en MySQL (YYYY-MM-DD HH:mm:ss)
    const formatMySQLDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
    const fRealStr = formatMySQLDate(fechaRealObj);
    const fFalsaStr = formatMySQLDate(fechaFalsaObj);

    // Insertar tarea en la base de datos
    const [result] = await pool.query(
      `INSERT INTO tareas (usuario_id, titulo, descripcion, fecha_limite_real, fecha_limite_falsa, estado) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [usuarioId, titulo, descripcion, fRealStr, fFalsaStr, ESTADOS.PENDIENTE]
    );

    res.status(201).json({
      mensaje: 'Tarea creada con éxito con Falsa Fecha Límite automatizada.',
      tareaId: result.insertId,
      titulo,
      fecha_limite_real: fRealStr,
      fecha_limite_falsa: fFalsaStr,
      margen_aplicado_horas: margenHoras,
      estado: ESTADOS.PENDIENTE
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar la tarea', detalles: err.message });
  }
});

// 4. Actualizar estado de una tarea aplicando la Máquina de Estados Estricta
app.put('/api/tareas/:id/estado', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { nuevoEstado } = req.body;

  if (!Object.values(ESTADOS).includes(nuevoEstado)) {
    return res.status(400).json({ error: `Estado inválido. Debe ser uno de: ${Object.values(ESTADOS).join(', ')}` });
  }

  try {
    const [tareas] = await pool.query('SELECT estado, titulo FROM tareas WHERE id = ? AND usuario_id = ?', [id, req.usuarioId]);
    if (tareas.length === 0) {
      return res.status(404).json({ error: 'La tarea no existe.' });
    }

    const estadoActual = tareas[0].estado;

    // Validar máquina de estados estricta
    if (!isValidTransition(estadoActual, nuevoEstado)) {
      return res.status(400).json({
        error: `Transición de estado denegada por la Máquina de Estados Estricta.`,
        estadoActual,
        estadoRequeridoSiguiente: estadoActual === ESTADOS.PENDIENTE ? ESTADOS.EN_PROGRESO : ESTADOS.ENVIADA,
        estadoIntentado: nuevoEstado,
        regla: 'El flujo obligatorio de vida de una tarea es: Pendiente ➔ En Progreso ➔ Enviada.'
      });
    }

    // Actualizar el estado
    await pool.query('UPDATE tareas SET estado = ? WHERE id = ?', [nuevoEstado, id]);

    res.json({
      mensaje: `Estado de la tarea '${tareas[0].titulo}' actualizado correctamente.`,
      id,
      estadoAnterior: estadoActual,
      estadoNuevo: nuevoEstado
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar el estado de la tarea', detalles: err.message });
  }
});

// 5. Obtener configuración del usuario (margen_horas)
app.get('/api/configuracion', authenticateToken, async (req, res) => {
  try {
    const [usuarios] = await pool.query('SELECT margen_horas FROM usuarios WHERE id = ?', [req.usuarioId]);
    if (usuarios.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    res.json({ margen_horas: usuarios[0].margen_horas });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener configuración', detalles: err.message });
  }
});

// 6. Actualizar configuración del usuario (margen_horas)
app.put('/api/configuracion', authenticateToken, async (req, res) => {
  const { margen_horas } = req.body;
  const usuarioId = req.usuarioId;

  if (margen_horas === undefined || margen_horas < 1 || margen_horas > 72) {
    return res.status(400).json({ error: 'El margen de horas debe ser un número entre 1 y 72.' });
  }

  try {
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
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar configuración', detalles: err.message });
  }
});

// 7. Eliminar tarea físicamente (solo si pertenece al usuario autenticado)
app.delete('/api/tareas/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query('DELETE FROM tareas WHERE id = ? AND usuario_id = ?', [id, req.usuarioId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'La tarea no existe.' });
    }
    res.json({ mensaje: `Tarea #${id} eliminada permanentemente.` });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar la tarea', detalles: err.message });
  }
});

// 8. Endpoint de Monitoreo de Alarmas Activas (Soporte conceptual para el Worker de Alerta Agresiva)
app.get('/api/alarmas', authenticateToken, async (req, res) => {
  try {
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

    // Encontrar la alarma más crítica actualmente activa para intensificar sonidos en frontend
    const maximaGravedad = alarmasDisparadas.reduce((max, curr) => {
      const jerarquia = { 'Ninguno': 0, 'Bajo': 1, 'Moderado': 2, 'Alto (Crítico)': 3, '¡MÁXIMO PELIGRO (CRÍTICO)!': 4 };
      const valCurr = jerarquia[curr.alarma.nivel] || 0;
      const valMax = jerarquia[max.nivel] || 0;
      return valCurr > valMax ? curr.alarma : max;
    }, { nivel: 'Ninguno', frecuenciaSegundos: 0, mensaje: 'No hay alarmas activas.' });

    res.json({
      alertasActivas: alarmasDisparadas,
      alarmaCriticaDominante: maximaGravedad
    });
  } catch (err) {
    res.status(500).json({ error: 'Error en el monitor de alarmas', detalles: err.message });
  }
});

// --- WORKER / CRON LIGERO INTEGRADO EN BACKEND ---
// Ejecuta un chequeo periódico interno simulando un Worker que alerta agresivamente en el servidor.
setInterval(async () => {
  try {
    if (pool) {
      const [tareasCriticas] = await pool.query(
        `SELECT titulo, fecha_limite_falsa, estado FROM tareas 
         WHERE estado != 'Enviada' AND fecha_limite_falsa <= NOW()`
      );
      if (tareasCriticas.length > 0) {
        console.warn(`⚠️ [WORKER ALERT - ${new Date().toLocaleTimeString()}]`);
        tareasCriticas.forEach(t => {
          console.warn(`🚨 ¡CRÍTICO! Tarea "${t.titulo}" ha superado su Falsa Fecha Límite. Estado actual: [${t.estado}].`);
        });
      }
    }
  } catch (err) {
    console.error('Error en el cron ligero del backend:', err.message);
  }
}, 15000); // Se ejecuta cada 15 segundos en segundo plano

// Levantar Servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor de Alarma Anti-Procrastinación corriendo en http://localhost:${PORT}`);
});
