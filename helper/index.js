#!/usr/bin/env node
// Asistente de escritorio de duokit: un servidor chiquito que corre en la compu del cliente. El sitio
// (https://duokit.online) le manda un "ticket" firmado por el servidor real (ver backend/download-ticket.js) y
// este Asistente, después de comprobar que el ticket es válido, ejecuta yt-dlp AQUÍ, con la IP normal del
// cliente — así ni el bloqueo de YouTube a servidores en la nube, ni los límites de cuántas descargas caben a la
// vez en Railway, aplican. El servidor sigue siendo el ÚNICO que decide SI se puede descargar (ver el ticket);
// este programa solo ejecuta lo que ya fue autorizado, nunca decide límites por su cuenta.
//
// NO PROBADO en una Windows o Mac reales (este entorno de desarrollo es Linux) — antes de repartirlo a un
// cliente, pruébalo tú mismo en tu compu real. La parte que más riesgo tiene es bajar-e-instalar ffmpeg solo
// (ensureFfmpeg más abajo): si el .zip de un proveedor cambia de estructura interna, hay que ajustar el código.
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PUBLIC_KEY_PEM } = require('./ticket-key');
const ytdlpArgs = require('../backend/ytdlp-args');

// En Windows, al abrir el .exe con doble clic, la ventana de la consola se cierra SOLA en cuanto el proceso
// termina — si algo truena, nadie alcanza a leer el error (así se reportó: "una ventana negra aparece y se
// cierra sola"). Esto atrapa cualquier error que no se haya manejado en ningún otro lado y deja la ventana
// abierta con el mensaje, esperando una tecla, en vez de cerrarse de inmediato.
function stayOpenOnError(err) {
  console.error('\n❌ El Asistente de duokit encontró un error y no puede seguir:\n');
  console.error(err && err.stack ? err.stack : err);
  console.error('\nEscríbele esto a soporte. Presiona Enter para cerrar esta ventana...');
  try {
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
  } catch {
    // Sin entrada estándar disponible (poco común): no hay más remedio que cerrar.
    process.exit(1);
  }
}
process.on('uncaughtException', stayOpenOnError);
process.on('unhandledRejection', stayOpenOnError);

const PORT = Number(process.env.DUOKIT_HELPER_PORT) || 47811;
// Se acepta duokit.online (producción) y localhost (para que el propio duokit pruebe el Asistente en desarrollo).
const ALLOWED_ORIGINS = new Set(['https://duokit.online', 'http://localhost:5173', 'http://localhost:5174']);

const APP_DIR = path.join(os.homedir(), '.duokit-helper');
const BIN_DIR = path.join(APP_DIR, 'bin');
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');
const EXE = process.platform === 'win32' ? '.exe' : '';

fs.mkdirSync(BIN_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Verificación del ticket (ver backend/download-ticket.js: mismo formato, clave pública en ticket-key.js)
// ---------------------------------------------------------------------------

const usedNonces = new Set();
setInterval(() => usedNonces.clear(), 60 * 60 * 1000).unref();

function verifyTicket(ticket) {
  const [encoded, signature] = String(ticket || '').split('.');
  if (!encoded || !signature) throw new Error('Ticket inválido.');
  const publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM);
  let ok;
  try {
    ok = crypto.verify(null, Buffer.from(encoded), publicKey, Buffer.from(signature, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('Firma inválida: este ticket no viene de duokit.online.');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (Date.now() > payload.exp) throw new Error('El ticket ya venció. Vuelve a pedir la descarga desde el sitio.');
  if (usedNonces.has(payload.nonce)) throw new Error('Este ticket ya se usó.');
  usedNonces.add(payload.nonce);
  return payload;
}

// ---------------------------------------------------------------------------
// yt-dlp y ffmpeg: se bajan solos la primera vez (una sola vez, se quedan en APP_DIR/bin para las próximas).
// ---------------------------------------------------------------------------

const YTDLP_URL = {
  win32: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
}[process.platform];

async function downloadFile(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`No se pudo bajar ${url} (HTTP ${res.status}).`);
  const tmp = `${destPath}.part`;
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const fileStream = fs.createWriteStream(tmp);
  await require('stream/promises').pipeline(require('stream').Readable.fromWeb(res.body), fileStream);
  await fs.promises.rename(tmp, destPath);
}

// Si ya existe una copia propia (bajada antes) o el programa ya está instalado en la compu (usuarios más
// técnicos), se usa esa — solo se baja una copia nueva si de plano no se encuentra en ningún lado.
function findOnPath(command) {
  // Se necesita la ruta completa, no el nombre suelto: yt-dlp usa este mismo valor para --ffmpeg-location, que
  // espera una ruta de archivo de verdad, no algo que solo resuelve la terminal por su cuenta vía PATH.
  const { status, stdout } = require('child_process').spawnSync(process.platform === 'win32' ? 'where' : 'which', [command]);
  if (status !== 0) return null;
  return stdout.toString().trim().split(/\r?\n/)[0] || null;
}

// yt-dlp.exe/ffmpeg.exe viajan SUELTOS, al lado del .exe, dentro del mismo .zip que se descarga del sitio (ver
// build.js) — así el Asistente nunca necesita "descargar otro programa de internet" al abrirse por primera vez.
//
// OJO: antes iban empacados DENTRO del .exe como "assets" de pkg, y este mismo programa los sacaba de su propio
// interior en cada arranque (fs.copyFileSync desde la snapshot virtual de pkg). Se cambió porque ese patrón —un
// solo ejecutable que trae otros ejecutables empacados adentro y los deja listos para correr al abrirse— es
// justo la firma clásica que un antivirus (no necesariamente Windows Defender; uno de terceros no deja rastro en
// su historial) usa para marcar algo como "dropper" sospechoso, sin mostrar ninguna ventana de aviso: un cliente
// reportó que el Asistente no abre ninguna ventana y el sitio nunca lo detecta, con el historial de Defender
// limpio — encaja exactamente con ese tipo de bloqueo silencioso de un antivirus distinto a Defender.
function copyBundled(name, dest) {
  // Empacado con pkg (process.pkg existe): process.execPath es la ruta real en disco del .exe que se está
  // ejecutando (no la snapshot virtual de pkg), y yt-dlp.exe/ffmpeg.exe viven sueltos justo a su lado.
  // Sin empacar (node index.js en desarrollo): se busca en helper/vendor/<plataforma>/ como antes.
  const bundled = process.pkg
    ? path.join(path.dirname(process.execPath), name)
    : path.join(__dirname, 'vendor', process.platform, name);
  if (!fs.existsSync(bundled)) return false;
  fs.copyFileSync(bundled, dest);
  return true;
}

async function ensureYtDlp() {
  const dest = path.join(BIN_DIR, `yt-dlp${EXE}`);
  if (fs.existsSync(dest)) return dest;
  if (copyBundled(`yt-dlp${EXE}`, dest)) {
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    return dest;
  }
  const onPath = findOnPath('yt-dlp');
  if (onPath) return onPath;
  if (!YTDLP_URL) throw new Error(`Sistema operativo no soportado: ${process.platform}.`);
  console.log('Descargando yt-dlp (una sola vez)...');
  await downloadFile(YTDLP_URL, dest);
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  return dest;
}

// Saca UN SOLO archivo de un .zip (por nombre, sin importar en qué carpeta esté adentro) y lo escribe directo en
// destPath. A propósito no se usa una librería que "recrea" todo el árbol del zip en disco (ni siquiera
// extract-zip, que en septiembre de 2026 tiene una vulnerabilidad sin parche de escritura de archivos fuera de la
// carpeta esperada, por symlinks dentro del zip) — yauzl solo nos da el flujo de datos de la entrada que pedimos,
// así que nunca ejecuta la parte riesgosa (crear symlinks/carpetas según lo que diga el zip).
function extractSingleFileFromZip(zipPath, targetName, destPath) {
  return new Promise((resolve, reject) => {
    require('yauzl').open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      let found = false;
      zipfile.on('entry', (entry) => {
        const base = entry.fileName.split('/').pop();
        if (!found && !entry.fileName.endsWith('/') && base?.toLowerCase() === targetName.toLowerCase()) {
          found = true;
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) return reject(err);
            const out = fs.createWriteStream(destPath);
            readStream.pipe(out);
            out.on('finish', () => {
              zipfile.close();
              resolve();
            });
            out.on('error', reject);
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => {
        if (!found) reject(new Error(`No se encontró "${targetName}" dentro del paquete descargado.`));
      });
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  });
}

// Igual, pero para el .tar.xz de Linux: node-tar (paquete `tar`, versión reciente sin vulnerabilidades conocidas
// de path-traversal) con un filtro que solo deja pasar la entrada que nos interesa.
async function extractSingleFileFromTar(tarPath, targetName, destPath) {
  const tmp = `${destPath}.extracting`;
  fs.mkdirSync(tmp, { recursive: true });
  try {
    await require('tar').extract({
      file: tarPath,
      cwd: tmp,
      filter: (entryPath) => entryPath.split('/').pop()?.toLowerCase() === targetName.toLowerCase(),
    });
    const found = fs.readdirSync(tmp, { recursive: true }).map((f) => path.join(tmp, f)).find((f) => fs.statSync(f).isFile());
    if (!found) throw new Error(`No se encontró "${targetName}" dentro del paquete descargado.`);
    fs.copyFileSync(found, destPath);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ffmpeg no viene en un solo archivo: hay que bajar un .zip/.tar.xz y sacar el binario de adentro. Fuentes
// conocidas y estables (no oficiales de FFmpeg, pero de uso común para esto):
//   Windows: gyan.dev (build "essentials", trae ffmpeg.exe dentro de una carpeta bin/)
//   macOS:   evermeet.cx (un .zip por binario, sin carpetas raras)
//   Linux:   johnvansickle.com (build estático, ffmpeg suelto dentro del .tar.xz)
async function ensureFfmpeg() {
  const dest = path.join(BIN_DIR, `ffmpeg${EXE}`);
  if (fs.existsSync(dest)) return dest;
  if (copyBundled(`ffmpeg${EXE}`, dest)) {
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    return dest;
  }
  const onPath = findOnPath('ffmpeg');
  if (onPath) return onPath;
  console.log('Descargando ffmpeg (una sola vez, puede tardar un poco)...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duokit-ffmpeg-'));
  try {
    if (process.platform === 'win32') {
      const zipPath = path.join(tmpDir, 'ffmpeg.zip');
      await downloadFile('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', zipPath);
      await extractSingleFileFromZip(zipPath, 'ffmpeg.exe', dest);
    } else if (process.platform === 'darwin') {
      const zipPath = path.join(tmpDir, 'ffmpeg.zip');
      await downloadFile('https://evermeet.cx/ffmpeg/getrelease/zip', zipPath);
      await extractSingleFileFromZip(zipPath, 'ffmpeg', dest);
      fs.chmodSync(dest, 0o755);
    } else {
      const tarPath = path.join(tmpDir, 'ffmpeg.tar.xz');
      await downloadFile('https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz', tarPath);
      await extractSingleFileFromTar(tarPath, 'ffmpeg', dest);
      fs.chmodSync(dest, 0o755);
    }
    return dest;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Trabajos de descarga (en memoria: este proceso es de un solo cliente, no hace falta más).
// ---------------------------------------------------------------------------

const jobs = new Map();
const activeChildren = new Set();

// En Windows no existen los grupos de procesos estilo POSIX (process.kill(-pid, ...) truena ahí), y child.kill()
// solo mata al proceso directo (yt-dlp), no a ffmpeg si yt-dlp ya lo había lanzado como hijo suyo — quedaría
// corriendo huérfano. `taskkill /t` sí mata todo el árbol y viene incluido en Windows, sin nada que instalar.
function killTree(child) {
  if (process.platform === 'win32') {
    require('child_process').spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function snapshotDir(dir) {
  try {
    return new Set(fs.readdirSync(dir));
  } catch {
    return new Set();
  }
}

function runYtDlp(ytDlpPath, ffmpegPath, args, job) {
  return new Promise((resolve, reject) => {
    const before = snapshotDir(job.dir);
    const child = spawn(ytDlpPath, ['--ffmpeg-location', ffmpegPath, ...args], { windowsHide: true });
    activeChildren.add(child);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output = (output + chunk).slice(-4000);
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/\[download\]\s+(\d{1,3}(?:\.\d+)?)%/);
        if (m) job.percent = Math.min(100, Math.round(parseFloat(m[1])));
      }
    });
    child.stderr.on('data', (chunk) => {
      output = (output + chunk).slice(-4000);
    });
    child.on('error', (err) => {
      activeChildren.delete(child);
      reject(new Error(`No se pudo ejecutar yt-dlp: ${err.message}`));
    });
    child.on('close', (code) => {
      activeChildren.delete(child);
      if (code !== 0) return reject(new Error(output.trim().split('\n').pop() || `yt-dlp terminó con código ${code}`));
      const created = [...snapshotDir(job.dir)].filter((name) => !before.has(name));
      if (created.length === 0) return reject(new Error('No se generó ningún archivo (¿el video no está disponible?).'));
      job.files.push(...created);
      resolve();
    });
  });
}

async function processJob(jobId, ticket) {
  const job = jobs.get(jobId);
  try {
    const ytDlpPath = await ensureYtDlp();
    const ffmpegPath = await ensureFfmpeg();
    const config = { ...ticket, dir: job.dir };
    const limits = { maxDurationMin: ticket.maxDurationMin, maxFileSize: ticket.maxFileSize };
    if (ticket.downloadVideo) {
      job.message = 'Descargando video...';
      await runYtDlp(ytDlpPath, ffmpegPath, ytdlpArgs.buildVideoArgs(config, limits), job);
    }
    if (ticket.downloadAudio) {
      job.message = 'Descargando audio...';
      await runYtDlp(ytDlpPath, ffmpegPath, ytdlpArgs.buildAudioArgs(config, limits), job);
    }
    if (ticket.downloadThumbnail) {
      job.message = 'Descargando miniatura...';
      await runYtDlp(ytDlpPath, ffmpegPath, ytdlpArgs.buildThumbnailArgs(config), job);
    }
    job.status = 'done';
    job.percent = 100;
    job.message = 'Descarga completada';
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
  }
}

// ---------------------------------------------------------------------------
// Servidor HTTP local (sin Express, para que el ejecutable empaquetado sea más chico y simple).
// ---------------------------------------------------------------------------

function withCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Chrome exige esto para dejar que una página HTTPS le hable a un puerto local (Private Network Access).
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Cuerpo inválido.'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  withCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/ping') {
    return sendJson(res, 200, { ok: true, version: require('./package.json').version });
  }

  if (req.method === 'POST' && url.pathname === '/download') {
    let ticket;
    try {
      const body = await readBody(req);
      ticket = verifyTicket(body.ticket);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const jobId = crypto.randomUUID();
    const dir = path.join(DOWNLOADS_DIR, `duokit-${jobId.slice(0, 8)}`);
    fs.mkdirSync(dir, { recursive: true });
    jobs.set(jobId, { status: 'running', percent: 0, message: 'Iniciando...', error: null, files: [], dir });
    processJob(jobId, ticket);
    return sendJson(res, 200, { jobId });
  }

  const statusMatch = req.method === 'GET' && /^\/status\/([^/]+)$/.exec(url.pathname);
  if (statusMatch) {
    const job = jobs.get(statusMatch[1]);
    if (!job) return sendJson(res, 404, { error: 'No encontrado.' });
    return sendJson(res, 200, {
      status: job.status,
      percent: job.percent,
      message: job.message,
      error: job.error,
      files: job.files.map((name) => ({ name, path: path.join(job.dir, name) })),
      folder: job.dir,
    });
  }

  sendJson(res, 404, { error: 'No encontrado.' });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of activeChildren) killTree(child);
    process.exit(0);
  });
}

// Si el puerto ya está ocupado, lo más probable es que YA haya otra copia del Asistente corriendo (por ejemplo,
// se abrió sin querer dos veces) — no es un error real, así que no truena la ventana con una pila de llamadas,
// solo lo explica y espera.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('El Asistente de duokit ya está corriendo (en otra ventana). No hace falta abrirlo otra vez.');
    console.log('Presiona Enter para cerrar esta ventana...');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(0));
    return;
  }
  stayOpenOnError(err);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Asistente de duokit escuchando en http://127.0.0.1:${PORT}`);
  console.log('Deja esta ventana abierta mientras uses duokit. Ciérrala cuando termines.');
});
