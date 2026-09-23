#!/usr/bin/env bash
# Baja yt-dlp.exe y ffmpeg.exe reales de Windows para incluirlos DENTRO del instalador (helper/vendor/win32/), en
# vez de que el Asistente los descargue solo la primera vez que alguien lo abre. Eso último es exactamente el
# patrón que los antivirus marcan como sospechoso ("descarga y ejecuta otros programas de internet") — un cliente
# reportó tener que desactivar su antivirus para poder usarlo. No se sube a git (pesan ~120 MB juntos, ver
# .gitignore): correr esto antes de `npm run build` cuando haga falta reconstruir el instalador de Windows.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p vendor/win32

echo "Bajando yt-dlp.exe..."
curl -sL -o vendor/win32/yt-dlp.exe https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe

echo "Bajando ffmpeg (build de gyan.dev) y sacando ffmpeg.exe..."
tmp=$(mktemp -d)
curl -sL -o "$tmp/ffmpeg.zip" https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
node -e "
const yauzl = require('yauzl');
yauzl.open('$tmp/ffmpeg.zip', { lazyEntries: true }, (err, zipfile) => {
  if (err) throw err;
  let found = false;
  zipfile.on('entry', (entry) => {
    const base = entry.fileName.split('/').pop();
    if (!found && !entry.fileName.endsWith('/') && base.toLowerCase() === 'ffmpeg.exe') {
      found = true;
      zipfile.openReadStream(entry, (err, rs) => {
        if (err) throw err;
        const out = require('fs').createWriteStream('vendor/win32/ffmpeg.exe');
        rs.pipe(out);
        out.on('finish', () => { zipfile.close(); console.log('listo:', entry.fileName); });
      });
    } else {
      zipfile.readEntry();
    }
  });
  zipfile.on('end', () => { if (!found) { console.error('No se encontró ffmpeg.exe en el zip.'); process.exit(1); } });
  zipfile.readEntry();
});
"
rm -rf "$tmp"
ls -la vendor/win32/
echo "Listo. Ahora corre: npm run build"
