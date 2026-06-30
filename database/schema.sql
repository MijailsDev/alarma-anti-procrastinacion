PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    margen_horas INTEGER DEFAULT 5 NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tareas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    titulo TEXT NOT NULL,
    descripcion TEXT,
    fecha_limite_real TEXT NOT NULL,
    fecha_limite_falsa TEXT NOT NULL,
    estado TEXT DEFAULT 'Pendiente' NOT NULL CHECK(estado IN ('Pendiente', 'En Progreso', 'Enviada')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_tokens(expires_at);

INSERT OR IGNORE INTO usuarios (id, username, email, password_hash, margen_horas)
VALUES (1, 'estudiante_unamad', 'sistemas.unamad@gmail.com', '$2b$10$st.r8pI5QUnyQPbnvQxksODN7uz1D5tOQpmvickgulDMnH3A7Bkha', 5);

INSERT INTO tareas (usuario_id, titulo, descripcion, fecha_limite_real, fecha_limite_falsa, estado)
VALUES
(1, 'Proyecto Final de Ingeniería de Software', 'Entregar el prototipo final con arquitectura limpia en Docker.',
 datetime('now', '+10 hours'), datetime('now', '+5 hours'), 'Pendiente'),
(1, 'Examen Parcial de Base de Datos II', 'Resolver los ejercicios prácticos de normalización y triggers.',
 datetime('now', '+2 hours'), datetime('now', '-3 hours'), 'En Progreso'),
(1, 'Laboratorio de Redes y Telecomunicaciones', 'Configurar el enrutamiento dinámico OSPF en Cisco Packet Tracer.',
 datetime('now', '+24 hours'), datetime('now', '+19 hours'), 'Enviada');
