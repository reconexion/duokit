#!/usr/bin/env node
// Construye los 4 instaladores. Windows va aparte (pkg.win.config.json) porque lleva empacados yt-dlp.exe y
// ffmpeg.exe de verdad (helper/vendor/win32/, bajados con ./fetch-vendor.sh antes de correr esto) — así el
// Asistente en Windows nunca necesita "descargar y ejecutar otro programa" al abrirse, que es justo el patrón que
// los antivirus marcan como sospechoso. Mac/Linux siguen bajando esas herramientas solos la primera vez (no hace
// falta cargarles esos ~120 MB que no ocupan).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const VENDOR_WIN = path.join(__dirname, 'vendor', 'win32');

function run(args) {
  console.log(`\n$ npx @yao-pkg/pkg ${args.join(' ')}`);
  execFileSync('npx', ['@yao-pkg/pkg', ...args], { cwd: __dirname, stdio: 'inherit' });
}

function rename(from, to) {
  const src = path.join(DIST, from);
  if (!fs.existsSync(src)) throw new Error(`No se generó ${from} — revisa el registro de pkg arriba.`);
  fs.renameSync(src, path.join(DIST, to));
}

fs.rmSync(DIST, { recursive: true, force: true });

// Mac/Linux: la configuración normal en package.json (sin los binarios de Windows).
run(['index.js', '--config', 'package.json']);
rename('duokit-helper-macos-x64', 'duokit-helper-mac-intel');
rename('duokit-helper-macos-arm64', 'duokit-helper-mac-apple-silicon');
rename('duokit-helper-linux-x64', 'duokit-helper-linux');

// Windows: solo si ya se bajaron los binarios reales (./fetch-vendor.sh) — si no, se avisa en vez de construir un
// instalador que de todos modos va a intentar descargarlos solo al abrirse (lo que se quiere evitar).
const hasVendor = fs.existsSync(path.join(VENDOR_WIN, 'yt-dlp.exe')) && fs.existsSync(path.join(VENDOR_WIN, 'ffmpeg.exe'));
if (!hasVendor) {
  console.warn('\n⚠ Faltan helper/vendor/win32/yt-dlp.exe y/o ffmpeg.exe — corre ./fetch-vendor.sh antes de construir Windows.');
  console.warn('  Por ahora NO se construyó el instalador de Windows.');
} else {
  run(['index.js', '--config', 'pkg.win.config.json']);
  // Con un config aparte (sin el "name" de package.json), pkg nombra la salida por el archivo de entrada
  // (index.js -> index.exe), no por el nombre del paquete — se renombra igual que los demás.
  rename('index.exe', 'duokit-helper-windows.exe');
}

console.log('\nListo. Archivos en dist/:');
for (const f of fs.readdirSync(DIST)) {
  const { size } = fs.statSync(path.join(DIST, f));
  console.log(`  ${f} — ${(size / 1024 / 1024).toFixed(1)} MB`);
}
