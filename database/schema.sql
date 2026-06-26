-- Crear la base de datos si no existe (normalmente docker-compose lo hace con MYSQL_DATABASE)
CREATE DATABASE IF NOT EXISTS `alarma_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `alarma_db`;

-- Tabla de Usuarios
CREATE TABLE IF NOT EXISTS `usuarios` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(50) NOT NULL UNIQUE,
    `email` VARCHAR(100) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `margen_horas` INT DEFAULT 5 NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de Tareas
CREATE TABLE IF NOT EXISTS `tareas` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `usuario_id` INT NOT NULL,
    `titulo` VARCHAR(100) NOT NULL,
    `descripcion` TEXT,
    `fecha_limite_real` DATETIME NOT NULL,
    `fecha_limite_falsa` DATETIME NOT NULL,
    `estado` ENUM('Pendiente', 'En Progreso', 'Enviada') DEFAULT 'Pendiente' NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migración para BD existentes: renombrar password a password_hash
-- ALTER TABLE usuarios CHANGE COLUMN password password_hash VARCHAR(255) NOT NULL;

-- Tabla de Refresh Tokens
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL,
    `token` VARCHAR(80) NOT NULL UNIQUE,
    `expires_at` DATETIME NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE,
    INDEX `idx_token` (`token`),
    INDEX `idx_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: usuario de prueba con contraseña hasheada (unamad2026 con bcrypt)
INSERT INTO `usuarios` (`id`, `username`, `email`, `password_hash`, `margen_horas`)
VALUES (1, 'estudiante_unamad', 'sistemas.unamad@gmail.com', '$2b$10$st.r8pI5QUnyQPbnvQxksODN7uz1D5tOQpmvickgulDMnH3A7Bkha', 5)
ON DUPLICATE KEY UPDATE `id`=`id`;

-- Insertar tareas de prueba vinculadas al usuario
INSERT INTO `tareas` (`usuario_id`, `titulo`, `descripcion`, `fecha_limite_real`, `fecha_limite_falsa`, `estado`)
VALUES
(1, 'Proyecto Final de Ingeniería de Software', 'Entregar el prototipo final con arquitectura limpia en Docker.', DATE_ADD(NOW(), INTERVAL 10 HOUR), DATE_ADD(NOW(), INTERVAL 5 HOUR), 'Pendiente'),
(1, 'Examen Parcial de Base de Datos II', 'Resolver los ejercicios prácticos de normalización y triggers.', DATE_ADD(NOW(), INTERVAL 2 HOUR), DATE_SUB(NOW(), INTERVAL 3 HOUR), 'En Progreso'),
(1, 'Laboratorio de Redes y Telecomunicaciones', 'Configurar el enrutamiento dinámico OSPF en Cisco Packet Tracer.', DATE_ADD(NOW(), INTERVAL 24 HOUR), DATE_ADD(NOW(), INTERVAL 19 HOUR), 'Enviada')
ON DUPLICATE KEY UPDATE `id`=`id`;
