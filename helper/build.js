#!/usr/bin/env node
// Construye los 4 instaladores. Para Windows, además arma un .zip con el .exe + yt-dlp.exe + ffmpeg.exe SUELTOS
// (helper/vendor/win32/, bajados con ./fetch-vendor.sh antes de correr esto) en vez de empacar esos binarios
// DENTRO del .exe: un solo ejecutable que trae otros ejecutables empacados adentro y los deja listos para correr
// al abrirse es justo el patrón que varios antivirus marcan como "dropper" sospechoso (a veces sin avisar nada,
// sin dejar rastro en el historial de Windows Defender). Con el .zip, el .exe queda del tamaño normal de un
// programa de Node empacado y los otros dos binarios viajan como archivos aparte, reconocibles como lo que son.
// Mac/Linux siguen bajando yt-dlp/ffmpeg solos la primera vez (no hace falta cargarles esos ~120 MB).
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

run(['index.js', '--config', 'package.json']);
rename('duokit-helper-macos-x64', 'duokit-helper-mac-intel');
rename('duokit-helper-macos-arm64', 'duokit-helper-mac-apple-silicon');
rename('duokit-helper-linux-x64', 'duokit-helper-linux');
rename('duokit-helper-win-x64.exe', 'duokit-helper-windows.exe');

// El .zip de Windows solo se arma si ya se bajaron los binarios reales (./fetch-vendor.sh) — si no, se avisa en
// vez de dejar un .exe suelto que de todos modos va a intentar bajarlos solo al abrirse (lo que se quiere evitar).
const hasVendor = fs.existsSync(path.join(VENDOR_WIN, 'yt-dlp.exe')) && fs.existsSync(path.join(VENDOR_WIN, 'ffmpeg.exe'));
if (!hasVendor) {
  console.warn('\n⚠ Faltan helper/vendor/win32/yt-dlp.exe y/o ffmpeg.exe — corre ./fetch-vendor.sh antes de construir Windows.');
  console.warn('  Se dejó duokit-helper-windows.exe suelto en dist/, SIN el .zip (no se debe repartir así).');
} else {
  const zipPath = path.join(DIST, 'duokit-helper-windows.zip');
  fs.rmSync(zipPath, { force: true });
  const stageDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'duokit-zip-'));
  try {
    fs.copyFileSync(path.join(DIST, 'duokit-helper-windows.exe'), path.join(stageDir, 'duokit-helper-windows.exe'));
    fs.copyFileSync(path.join(VENDOR_WIN, 'yt-dlp.exe'), path.join(stageDir, 'yt-dlp.exe'));
    fs.copyFileSync(path.join(VENDOR_WIN, 'ffmpeg.exe'), path.join(stageDir, 'ffmpeg.exe'));
    execFileSync('zip', ['-j', '-q', zipPath,
      path.join(stageDir, 'duokit-helper-windows.exe'),
      path.join(stageDir, 'yt-dlp.exe'),
      path.join(stageDir, 'ffmpeg.exe'),
    ]);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  // El .exe suelto (sin zip) ya no se reparte — solo el .zip completo, para que los 3 archivos siempre viajen
  // juntos. Se deja fuera de dist/ para no subirlo por error.
  fs.rmSync(path.join(DIST, 'duokit-helper-windows.exe'));
}

console.log('\nListo. Archivos en dist/:');
for (const f of fs.readdirSync(DIST)) {
  const { size } = fs.statSync(path.join(DIST, f));
  console.log(`  ${f} — ${(size / 1024 / 1024).toFixed(1)} MB`);
}
