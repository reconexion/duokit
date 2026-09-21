const express = require('express');
const auth = require('./auth');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const PORT = 3001;

// Los archivos no se guardan en el proyecto: yt-dlp los prepara en una carpeta temporal fuera de él,
// el navegador los recibe como una descarga normal y se borran solos pasado FILE_TTL_MS.
// (Va en el disco, no en /tmp, porque /tmp suele ser memoria y un video puede pesar cientos de MB.)
const JOBS_ROOT = process.env.DUOKIT_TMP_DIR || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'duokit', 'jobs');
const FILE_TTL_MS = Number(process.env.DUOKIT_FILE_TTL_MS) || 10 * 60 * 1000;

fs.rmSync(JOBS_ROOT, { recursive: true, force: true }); // restos de una ejecución anterior
fs.mkdirSync(JOBS_ROOT, { recursive: true, mode: 0o700 });

const app = express();
// Sin CORS: el frontend habla con este backend por el mismo origen (proxy de Vite),
// así la cookie de sesión nunca viaja a otros sitios.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(auth.sameOriginOnly);

// Almacén en memoria de trabajos de descarga en curso/terminados.
const jobs = new Map();

const TIME_REGEX = /^\d{2}:\d{2}:\d{2}$/;
const VIDEO_QUALITY_MAP = {
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
  '2K': 1440,
  '4K': 2160,
};
const AUDIO_QUALITY_SET = new Set(['64k', '128k', '192k', '256k', '320k']);
const AUDIO_LANG_SET = new Set(['original', 'es', 'en', 'pt', 'fr', 'de', 'ja', 'ko', 'it', 'ru', 'hi', 'ar']);

// Solo enlaces http(s) de youtube.com. Evita que un valor tipo "--opcion youtube.com"
// llegue a yt-dlp como si fuera una opción.
function isYouTubeUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const { protocol, hostname } = new URL(value.trim());
    return (protocol === 'https:' || protocol === 'http:') && (hostname === 'youtube.com' || hostname.endsWith('.youtube.com'));
  } catch {
    return false;
  }
}

function validatePayload(body) {
  const errors = [];
  const {
    url,
    downloadVideo,
    downloadAudio,
    downloadThumbnail,
    videoQuality,
    audioQuality,
    audioLang,
    startTime,
    endTime,
  } = body;

  if (!isYouTubeUrl(url)) {
    errors.push('URL de YouTube inválida.');
  }
  if (!downloadVideo && !downloadAudio && !downloadThumbnail) {
    errors.push('Debes seleccionar al menos una opción de descarga.');
  }
  if (downloadVideo && !VIDEO_QUALITY_MAP[videoQuality]) {
    errors.push('Calidad de video inválida.');
  }
  if (downloadAudio && !AUDIO_QUALITY_SET.has(audioQuality)) {
    errors.push('Calidad de audio inválida.');
  }
  if (audioLang && !AUDIO_LANG_SET.has(audioLang)) {
    errors.push('Idioma de audio inválido.');
  }
  if (startTime && !TIME_REGEX.test(startTime)) {
    errors.push('Formato de tiempo de inicio inválido.');
  }
  if (endTime && !TIME_REGEX.test(endTime)) {
    errors.push('Formato de tiempo de finalización inválido.');
  }

  return errors;
}

function buildSectionArgs(startTime, endTime) {
  if (!startTime && !endTime) return [];
  const section = `*${startTime || ''}-${endTime || ''}`;
  return ['--download-sections', section, '--force-keyframes-at-cuts'];
}

// El campo "language" de un formato de audio de YouTube identifica la pista
// de doblaje (multi-audio track). Filtrando por él se elige ese doblaje en
// vez del audio original, con fallback si el video no lo tiene disponible.
function audioSelector(config, extraFilter = '') {
  if (config.audioLang && config.audioLang !== 'original') {
    return `bestaudio[language=${config.audioLang}]${extraFilter}/bestaudio${extraFilter}`;
  }
  return `bestaudio${extraFilter}`;
}

function buildVideoArgs(config) {
  const maxHeight = VIDEO_QUALITY_MAP[config.videoQuality];
  const format = `bestvideo[height<=${maxHeight}][ext=mp4]+${audioSelector(config, '[ext=m4a]')}/best[height<=${maxHeight}][ext=mp4]/best[height<=${maxHeight}]`;
  return [
    config.url,
    '-P', config.dir,
    '--newline',
    '--no-playlist',
    '--restrict-filenames',
    '-f', format,
    '--merge-output-format', 'mp4',
    '-o', '%(title)s.%(ext)s',
    ...buildSectionArgs(config.startTime, config.endTime),
  ];
}

function buildAudioArgs(config) {
  const bitrate = config.audioQuality.toUpperCase();
  return [
    config.url,
    '-P', config.dir,
    '--newline',
    '--no-playlist',
    '--restrict-filenames',
    '-x',
    '-f', audioSelector(config),
    '--audio-format', 'mp3',
    '--audio-quality', bitrate,
    '-o', '%(title)s.%(ext)s',
    ...buildSectionArgs(config.startTime, config.endTime),
  ];
}

function buildThumbnailArgs(config) {
  return [
    config.url,
    '-P', config.dir,
    '--newline',
    '--no-playlist',
    '--restrict-filenames',
    '--skip-download',
    '--write-thumbnail',
    '--convert-thumbnails', 'jpg',
    '-o', '%(title)s.%(ext)s',
  ];
}

function snapshotDir(dir) {
  return new Set(fs.readdirSync(dir));
}

function runYtDlp(args, job, stageLabel) {
  return new Promise((resolve, reject) => {
    job.stage = stageLabel;
    job.percent = 0;

    const before = snapshotDir(job.dir);
    const child = spawn('yt-dlp', args);
    let stderrOutput = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;

        const progressMatch = line.match(/\[download\]\s+(\d{1,3}(?:\.\d+)?)%/);
        if (progressMatch) {
          job.percent = Math.min(100, Math.round(parseFloat(progressMatch[1])));
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrOutput += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`No se pudo ejecutar yt-dlp: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        job.percent = 100;
        // Los archivos que quedan en disco al terminar la etapa son el
        // resultado final; yt-dlp ya limpió los fragmentos intermedios
        // (streams separados de audio/video antes de fusionarlos, etc.).
        const after = snapshotDir(job.dir);
        for (const name of after) {
          if (!before.has(name) && !job.files.includes(name)) {
            job.files.push(name);
          }
        }
        resolve();
      } else {
        reject(new Error(stderrOutput.trim() || `yt-dlp finalizó con código ${code}`));
      }
    });
  });
}

async function processJob(jobId, config) {
  const job = jobs.get(jobId);
  try {
    if (config.downloadVideo) {
      job.message = 'Descargando video...';
      await runYtDlp(buildVideoArgs(config), job, 'video');
    }
    if (config.downloadAudio) {
      job.message = 'Descargando audio...';
      await runYtDlp(buildAudioArgs(config), job, 'audio');
    }
    if (config.downloadThumbnail) {
      job.message = 'Descargando miniatura...';
      await runYtDlp(buildThumbnailArgs(config), job, 'thumbnail');
    }
    job.status = 'done';
    job.stage = null;
    job.message = 'Descarga completada';
    job.finishedAt = Date.now();
  } catch (err) {
    job.status = 'error';
    job.stage = null;
    job.message = 'No se pudo descargar el video.';
    job.error = err.message;
    removeJobFiles(job); // no dejar fragmentos a medias
  }
}

function removeJobFiles(job) {
  fs.rm(job.dir, { recursive: true, force: true }, () => {});
}

// Borra los archivos de los trabajos terminados que ya cumplieron su tiempo de espera.
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > FILE_TTL_MS) {
      removeJobFiles(job);
      jobs.delete(id);
    }
  }
}, Math.min(60 * 1000, FILE_TTL_MS)).unref();

// Al apagar el backend no queda nada en disco.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    fs.rmSync(JOBS_ROOT, { recursive: true, force: true });
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || username.length > 64 || !password || password.length > 200) {
    return res.status(400).json({ error: 'Escribe tu usuario y tu contraseña.' });
  }

  const wait = auth.retryAfterSeconds(req.ip, username);
  if (wait > 0) {
    res.setHeader('Retry-After', String(wait));
    return res.status(429).json({
      error: `Demasiados intentos. Vuelve a intentarlo en ${Math.ceil(wait / 60)} min.`,
      retryAfter: wait,
    });
  }

  const user = await auth.authenticate(username, password);
  if (!user) {
    auth.registerFailure(req.ip, username);
    return res.status(401).json({ error: 'El usuario o la contraseña no son correctos.' });
  }

  // Las credenciales son correctas, pero el acceso ya venció: no se abre sesión.
  if (auth.isExpired(user)) {
    return res.status(403).json({ error: auth.expiredMessage(user), code: 'access_expired' });
  }

  auth.clearFailures(req.ip, username);
  auth.setSessionCookie(req, res, user.id);
  res.json({ user: auth.publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = auth.currentUser(req);
  if (!user) return res.status(401).json({ error: 'No hay sesión activa.' });
  if (auth.isExpired(user)) return res.status(401).json({ error: auth.expiredMessage(user), code: 'access_expired' });
  res.json({ user: auth.publicUser(user) });
});

// Todo lo que sigue requiere haber iniciado sesión.
// Entrega el archivo como descarga del navegador (Content-Disposition: attachment).
// Solo se sirven los archivos que el propio trabajo generó, y solo a su dueño.
app.get('/downloads/:jobId/:name', auth.requireAuth, (req, res) => {
  const job = jobs.get(req.params.jobId);
  const { name } = req.params;
  if (!job || job.userId !== req.user.id || job.status !== 'done' || !job.files.includes(name)) {
    return res.status(404).json({ error: 'Este archivo ya no está disponible. Vuelve a descargarlo.' });
  }
  const file = path.join(job.dir, name);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'Este archivo ya no está disponible. Vuelve a descargarlo.' });
  }
  res.download(file, name);
});

app.post('/api/download', auth.requireAuth, (req, res) => {
  const errors = validatePayload(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  const jobId = crypto.randomUUID();
  const dir = path.join(JOBS_ROOT, jobId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  jobs.set(jobId, {
    status: 'running',
    stage: null,
    percent: 0,
    message: 'Iniciando descarga...',
    error: null,
    files: [],
    userId: req.user.id,
    dir,
    finishedAt: null,
  });

  processJob(jobId, { ...req.body, url: req.body.url.trim(), dir });

  res.json({ jobId });
});

app.get('/api/status/:jobId', auth.requireAuth, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.userId !== req.user.id) {
    return res.status(404).json({ error: 'Trabajo no encontrado.' });
  }
  res.json({
    status: job.status,
    stage: job.stage,
    percent: job.percent,
    message: job.message,
    error: job.error,
    files: job.files.map((name) => ({
      name,
      url: `/downloads/${req.params.jobId}/${encodeURIComponent(name)}`,
    })),
  });
});

app.listen(PORT, () => {
  console.log(`Backend de yt-dlp escuchando en http://localhost:${PORT}`);
  console.log(`Archivos temporales (se borran solos): ${JOBS_ROOT}`);
});
