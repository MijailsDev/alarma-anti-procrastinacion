-- Crear la base de datos si no existe (normalmente docker-compose lo hace con MYSQL_DATABASE)
CREATE DATABASE IF NOT EXISTS `alarma_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `alarma_db`;

-- Tabla de Usuarios
CREATE TABLE IF NOT EXISTS `usuarios` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(50) NOT NULL UNIQUE,
    `email` VARCHAR(100) NOT NULL UNIQUE,
    `password` VARCHAR(255) NOT NULL, -- Almacenará la contraseña (idealmente con hash bcrypt)
    `margen_horas` INT DEFAULT 5 NOT NULL, -- Margen de horas para la Falsa Fecha Límite (FFL) parametrizable
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de Tareas
CREATE TABLE IF NOT EXISTS `tareas` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `usuario_id` INT NOT NULL,
    `titulo` VARCHAR(100) NOT NULL,
    `descripcion` TEXT,
    `fecha_limite_real` DATETIME NOT NULL, -- Fecha de entrega oficial de la universidad
    `fecha_limite_falsa` DATETIME NOT NULL, -- Falsa Fecha Límite (FFL) calculada (fecha_limite_real - margen_horas)
    `estado` ENUM('Pendiente', 'En Progreso', 'Enviada') DEFAULT 'Pendiente' NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insertar Datos de Prueba (Seeders)
-- Contraseña de prueba en texto plano o hash para el estudiante de la UNAMAD
INSERT INTO `usuarios` (`id`, `username`, `email`, `password`, `margen_horas`) 
VALUES (1, 'estudiante_unamad', 'sistemas.unamad@gmail.com', 'unamad2026', 5)
ON DUPLICATE KEY UPDATE `id`=`id`;

-- Insertar tareas de prueba vinculadas al usuario
-- Nota: Usamos fechas relativas en SQL para que las pruebas de alarmas siempre tengan sentido
INSERT INTO `tareas` (`usuario_id`, `titulo`, `descripcion`, `fecha_limite_real`, `fecha_limite_falsa`, `estado`)
VALUES 
(1, 'Proyecto Final de Ingeniería de Software', 'Entregar el prototipo final con arquitectura limpia en Docker.', DATE_ADD(NOW(), INTERVAL 10 HOUR), DATE_ADD(NOW(), INTERVAL 5 HOUR), 'Pendiente'),
(1, 'Examen Parcial de Base de Datos II', 'Resolver los ejercicios prácticos de normalización y triggers.', DATE_ADD(NOW(), INTERVAL 2 HOUR), DATE_SUB(NOW(), INTERVAL 3 HOUR), 'En Progreso'), -- Ya venció su FFL!
(1, 'Laboratorio de Redes y Telecomunicaciones', 'Configurar el enrutamiento dinámico OSPF en Cisco Packet Tracer.', DATE_ADD(NOW(), INTERVAL 24 HOUR), DATE_ADD(NOW(), INTERVAL 19 HOUR), 'Enviada')
ON DUPLICATE KEY UPDATE `id`=`id`;
