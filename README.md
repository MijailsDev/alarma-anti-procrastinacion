# ⏱️ Alarma Anti-Procrastinación

Documentación técnica oficial y manual de usuario para el sistema inteligente de alerta y gestión estricta de plazos académicos. Adaptado con lógica rigurosa y blindaje contra la postergación crónica para estudiantes de la **Universidad Nacional Amazónica de Madre de Dios (UNAMAD)**, en particular para la carrera de **Ingeniería de Sistemas**.

---

## 📖 1. Descripción General

La **Alarma Anti-Procrastinación** es una herramienta de software diseñada para mitigar y combatir la postergación crónica en la entrega de laboratorios, proyectos y tareas del aula virtual. A diferencia de las agendas tradicionales que confían en la buena voluntad del usuario, este sistema asume que el estudiante tenderá a postergar la entrega hasta el último minuto y, por ende, aplica reglas de negocio automatizadas e implacables para romper el ciclo del sueño o la inacción.

La solución combina un cálculo automatizado de plazos simulados, una máquina de estados estricta y un monitor de alarmas sonoras e interactivas que intensifican su molestia a medida que el plazo ficticio expira.

---

## 🏗️ 2. Arquitectura de Software

El sistema utiliza una arquitectura desacoplada y contenerizada mediante **Docker** y **Docker Compose**, lo que garantiza portabilidad y aislamiento en entornos Windows 11 con WSL (Ubuntu).

```
 ┌─────────────────────────────────────────────────────────┐
 │                      FRONTEND PWA                       │
 │      HTML5 / CSS3 (Estroboscópico) / Vanilla JS         │
 │      Web Audio API (Generador de onda sawtooth)         │
 └───────────────────────────┬─────────────────────────────┘
                             │
                             │ (Peticiones HTTP REST / JSON)
                             ▼
 ┌─────────────────────────────────────────────────────────┐
 │                   BACKEND (Express API)                 │
 │            Módulos ESM (Node.js 18-Alpine)              │
 │          Worker ligero de escaneo en background         │
 └───────────────────────────┬─────────────────────────────┘
                             │
                             │ (mysql2 / Pool de Conexiones)
                             ▼
 ┌─────────────────────────────────────────────────────────┐
 │                 BASE DE DATOS (MySQL 8.0)               │
 │                Esquema relacional estricto              │
 └─────────────────────────────────────────────────────────┘
```

### Componentes y Puertos Configurados

1. **Base de Datos (MySQL 8.0):**
   - **Servicio Docker:** `db`
   - **Puerto Interno:** `3306` | **Puerto Externo (Expueto):** `3307`
   - **Características:** Persistencia mediante un volumen de datos Docker (`db_data`) y carga automática del script DDL (`schema.sql`) para inicialización de tablas y seeders al levantar el contenedor por primera vez.

2. **Backend (Node.js 18-Alpine & Express):**
   - **Servicio Docker:** `app`
   - **Puerto de Escucha:** `3000` (Expuesto y mapeado `3000:3000`)
   - **Características:** Uso nativo de Módulos de JavaScript (`"type": "module"`), recarga en vivo durante el desarrollo mediante `nodemon`, pool de conexiones de promesas (`mysql2/promise`) y un micro-worker interno (`setInterval`) que monitorea y alerta sobre tareas procrastinadas cada 15 segundos en la consola del servidor.

3. **Frontend PWA (Cliente Estático):**
   - **Puerto de Servicio:** `5000` (Levantado mediante servidor local ultra-ligero)
   - **Características:** Estructura limpia de Progressive Web App (PWA) con Service Worker (`sw.js`) listo para caché sin conexión y gestión de eventos Push. Emplea la **Web Audio API** para generar de manera nativa y directa en el navegador un tono de alarma agresivo de onda de sierra (`sawtooth`) sin necesidad de depender de archivos de audio externos.

---

## 🚀 3. Guía de Inicialización Paso a Paso

Sigue las siguientes instrucciones dentro de tu entorno **WSL (Ubuntu)** en Windows 11 para levantar los servicios desde cero:

### Paso 1: Levantar los contenedores de Docker
Dirígete a la carpeta raíz del proyecto y levanta el entorno contenerizado. Esto compilará el backend, descargará MySQL 8.0 y ejecutará el script SQL de inicialización de forma automática:
```bash
cd /home/caffe/proyectos/alarma-anti-procrastinacion
docker compose up -d
```
*Para verificar que los contenedores están corriendo y con buena salud, puedes ejecutar:*
```bash
docker compose ps
```

### Paso 2: Servir el Frontend
Para evitar problemas de CORS y asegurar el correcto registro del Service Worker de la PWA, sirve los archivos estáticos desde un servidor web local. Ejecuta el servidor integrado de Python desde la raíz del frontend en el puerto `5000`:
```bash
python3 -m http.server 5000 --directory ./frontend
```
Ahora, abre tu navegador web preferido e ingresa a: **`http://localhost:5000`**

### Paso 3: Activación Crítica de Permisos de Audio 🔊
> ⚠️ **NOTA CRÍTICA DE USABILIDAD:** Los navegadores web modernos (Chrome, Edge, Firefox) bloquean la reproducción de audio automática hasta que el usuario interactúe con el documento. 
> 
> **Debes hacer clic en cualquier parte de la pantalla** una vez que cargue la interfaz. Esto inicializará el `AudioContext` de la Web Audio API y garantizará que los tonos de alarma de pánico se escuchen de manera inmediata.

---

## 🧠 4. Reglas de Negocio ("Modo Pro")

Este software no es un gestor de tareas tradicional; está diseñado bajo un modelo de disciplina digital estricta:

### A. Falsa Fecha Límite (FFL) Automatizada
Cuando registras una tarea ingresando su fecha y hora límite real de entrega (la que indica el aula virtual de la UNAMAD), el backend intercepta el valor, consulta el margen de amortiguación del perfil del usuario (configurable, por defecto **5 horas**) y calcula de forma automática la **Falsa Fecha Límite (FFL)**:

$$\text{FFL} = \text{Fecha Límite Real} - 5\text{ horas}$$

Toda la interfaz del estudiante, las alertas, las cuentas regresivas y el zumbido de alarma se regirán **estrictamente bajo esta FFL**. Esto te obliga psicológicamente y operativamente a entregar tu trabajo con 5 horas de anticipación real, dándote un colchón de seguridad invaluable en caso de imprevistos técnicos o cansancio.

### B. Máquina de Estados Estricta
El ciclo de vida de una tarea es unidireccional y riguroso. Los estados permitidos son:
1. `Pendiente` (Al registrar la tarea)
2. `En Progreso` (Cuando el estudiante empieza activamente a trabajar en ella)
3. `Enviada` (Entrega confirmada y subida al aula virtual)

**Regla de Transición Inflexible:** No se permiten saltos de estados inválidos (por ejemplo, intentar pasar una tarea de `Pendiente` a `Enviada` sin pasar por `En Progreso`, o intentar volver una tarea ya entregada a un estado anterior). Si intentas realizar una transición fuera de la secuencia `Pendiente ➔ En Progreso ➔ Enviada`, el backend rechazará la transacción mediante código de error `400` y desplegará una alerta explicativa.

### C. Alertas y Alarmas en Cascada (Modo de Pánico Máximo)
El sistema evalúa continuamente en tiempo real el tiempo restante para alcanzar la FFL y calcula la gravedad del recordatorio:

| Tiempo Restante para la FFL | Nivel de Alerta | Comportamiento del Frontend | Frecuencia de Alarma |
| :--- | :--- | :--- | :--- |
| **Más de 5 horas** | `Bajo` | Tarjeta en verde. Recordatorio pasivo. | Sin sonido activo |
| **Entre 1 y 5 horas** | `Moderado` | Tarjeta en amarillo. Advertencia persistente. | Tono suave cada 10 segundos |
| **Menos de 1 hora** | `Alto (Crítico)` | Tarjeta en naranja. Urgencia evidente. | Pitido intermitente cada 2.5 segundos |
| **FFL Superada y no Enviada** | `¡MÁXIMO PELIGRO!` | **Modo Pánico:** CSS estroboscópico parpadeante en pantalla. | **Buzzer continuo cada 0.8 segundos (sawtooth)** |

*El zumbador de pánico solo se apagará definitivamente cuando el estudiante actualice el estado de la tarea a **`Enviada`**.*
*Se incluye un botón de **Silencio Temporal** que detiene el pitido por **3 minutos** para permitir al usuario concentrarse en la entrega final. Si el estado no cambia a 'Enviada' al expirar el tiempo, el pitido agresivo regresará.*

---

## 🛠️ 5. Comandos de Mantenimiento y Diagnóstico

### Ver logs en tiempo real del ecosistema Docker
Permite inspeccionar lo que sucede en el backend, las peticiones entrantes y la salida por consola del worker de monitoreo de alarmas:
```bash
docker compose logs -f
```

### Resetear / Limpiar por completo la tabla de tareas
Si deseas limpiar tu base de datos de pruebas o eliminar todas las tareas registradas para empezar un nuevo ciclo académico limpio, ejecuta el siguiente comando SQL directamente en el contenedor de base de datos MySQL mediante `docker exec` (sin necesidad de entrar de manera interactiva):
```bash
docker exec -it alarma_db mysql -u alarma_user -palarma_pass_sec_2026 -e "USE alarma_db; TRUNCATE TABLE tareas;"
```

### Apagar los servicios de Docker liberando recursos
Cuando no estés estudiando y desees detener el entorno de desarrollo por completo:
```bash
docker compose down
```
*(Los datos de la base de datos se mantendrán seguros e intactos gracias al volumen persistente `db_data`)*.
