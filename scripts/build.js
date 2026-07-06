const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(ROOT, 'frontend', 'icons');
const ICON_PNG = path.join(ICONS_DIR, 'icon-256.png');

function log(msg) {
  console.log(`[build] ${msg}`);
}

function checkIcon() {
  if (!fs.existsSync(ICON_PNG) || fs.statSync(ICON_PNG).size < 100) {
    log('Generando icono PNG desde SVG...');
    try {
      execSync('python3 scripts/generate-icons.py', { cwd: ROOT, stdio: 'inherit' });
    } catch {
      log('AVISO: No se pudo generar el icono. Usando SVG como fallback.');
    }
  } else {
    log(`Icono encontrado: ${ICON_PNG}`);
  }
}

function installBackendDeps() {
  const backendDir = path.join(ROOT, 'backend');
  log('Instalando dependencias de produccion del backend...');
  execSync('npm install --production --ignore-scripts', { cwd: backendDir, stdio: 'inherit' });
  log('Dependencias del backend listas.');
}

function runBuild(target) {
  const validTargets = ['win', 'linux', 'mac'];
  const t = validTargets.includes(target) ? target : 'win';

  installBackendDeps();
  log(`Iniciando build para ${t}...`);
  execSync(`npx electron-builder build --${t} --config electron-builder.yml`, {
    cwd: ROOT,
    stdio: 'inherit'
  });
}

function main() {
  const target = process.argv[2] || 'win';
  log(`Build target: ${target}`);
  checkIcon();
  runBuild(target);
  log('Build completado.');
}

main();
