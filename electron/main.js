const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');

let mainWindow = null;
let backendProcess = null;
const isDev = !app.isPackaged;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function waitForBackend(port, maxRetries = 30, interval = 500) {
  return new Promise((resolve) => {
    let retries = 0;
    function check() {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          retry();
        }
      });
      req.on('error', () => retry());
      req.setTimeout(2000, () => { req.destroy(); retry(); });
    }
    function retry() {
      retries++;
      if (retries >= maxRetries) {
        resolve(false);
      } else {
        setTimeout(check, interval);
      }
    }
    check();
  });
}

function startBackend(port) {
  const backendPath = isDev
    ? path.join(__dirname, '..', 'backend', 'index.js')
    : path.join(process.resourcesPath, 'backend', 'index.js');

  const dbPath = path.join(app.getPath('userData'), 'alarma.db');

  backendProcess = spawn(process.execPath, [backendPath], {
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      DB_PATH: dbPath,
      NODE_ENV: isDev ? 'development' : 'production',
      JWT_SECRET: process.env.JWT_SECRET || 'alarma-anti-procrastinacion-desktop-secret-2026',
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: isDev ? path.join(__dirname, '..') : process.resourcesPath
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.on('error', (err) => {
    console.error('[backend] Failed to start:', err.message);
  });

  backendProcess.on('exit', (code, signal) => {
    console.log(`[backend] Exited (code: ${code}, signal: ${signal})`);
    backendProcess = null;
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Alarma Anti-Procrastinación',
    show: false,
    icon: isDev
      ? path.join(__dirname, '..', 'frontend', 'icons', 'icon-512.svg')
      : path.join(process.resourcesPath, 'frontend', 'icons', 'icon-512.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--backend-port=${port}`]
    }
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'notifications');
  });

  const frontendPath = isDev
    ? path.join(__dirname, '..', 'frontend', 'index.html')
    : path.join(process.resourcesPath, 'frontend', 'index.html');

  mainWindow.loadFile(frontendPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const port = await getFreePort();
  startBackend(port);

  const ready = await waitForBackend(port);
  if (!ready) {
    console.error('[backend] No respondió dentro del tiempo de espera');
  }

  createWindow(port);
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});
