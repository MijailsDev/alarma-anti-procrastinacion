const { app, BrowserWindow, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { pathToFileURL } = require('url');

let mainWindow = null;
const isDev = !app.isPackaged;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

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

function resolvePath(relative) {
  return isDev
    ? path.join(__dirname, '..', relative)
    : path.join(process.resourcesPath, relative);
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Alarma Anti-Procrastinacion',
    show: false,
    icon: resolvePath('frontend/icons/icon-256.png'),
    backgroundColor: '#121214',
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

  mainWindow.loadFile(resolvePath('frontend/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const port = await getFreePort();

  const dbPath = path.join(app.getPath('userData'), 'alarma.db');

  try {
    if (!isDev) {
      process.env.NODE_ENV = 'production';
    }

    const backendPath = resolvePath('backend/index.js');
    const { startServer, stopServer } = await import(pathToFileURL(backendPath).href);

    global.__backendServer = { stopServer };
    await startServer({
      port,
      dbPath,
      logLevel: isDev ? 'debug' : 'warn'
    });

    console.log(`[main] Backend iniciado en puerto ${port}`);
  } catch (err) {
    dialog.showErrorBox(
      'Error critico',
      `No se pudo iniciar el backend:\n${err.message}`
    );
    app.quit();
    return;
  }

  createWindow(port);
});

app.on('window-all-closed', () => {
  if (global.__backendServer) {
    global.__backendServer.stopServer();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (global.__backendServer) {
    global.__backendServer.stopServer();
  }
});

app.on('will-quit', () => {
  if (global.__backendServer) {
    global.__backendServer.stopServer();
  }
});
