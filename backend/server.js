const express = require('express');
const config = require('./config'); // primero: fija la zona horaria antes de cualquier fecha
const auth = require('./auth');
const audit = require('./audit');
const limits = require('./limits');
const health = require('./health');
const { LIMITS, PLANS } = require('./plans');
const adminRouter = require('./admin');
const billing = require('./billing');
const payments = require('./payments');
const mercadopagoCheckout = require('./mercadopago-checkout');
const credentials = require('./credentials');
const { buildReceipt } = require('./receipts');
const { strategyArgs: ytdlpStrategyArgs } = require('./ytdlp-strategy');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3001;
// Solo escucha en este equipo por defecto: al público lo atiende el proxy (nginx) o el proxy de Vite. Para
// exponerlo directamente pon HOST=0.0.0.0 (documentado en deploy/RAILWAY.md y deploy/README.md) — y, como
// respaldo por si esa variable queda sin poner, el propio Dockerfile ya fija NODE_ENV=production (ver Dockerfile),
// así que en un contenedor este default cambia solo a 0.0.0.0; en local (npm start, sin NODE_ENV) sigue en 127.0.0.1.
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

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
// Detrás de un proxy inverso (nginx, Cloudflare...) hay que decirlo para ver la IP real del cliente: TRUST_PROXY=1.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
// Si llegan peticiones reenviadas por un proxy externo pero TRUST_PROXY no está puesto, todos los clientes se ven con la
// misma IP (los límites por IP se mezclan). El proxy de Vite en local reenvía desde 127.0.0.1 y no cuenta.
let warnedProxy = false;
app.use((req, res, next) => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (!warnedProxy && !process.env.TRUST_PROXY && forwarded && !/^(::1|::ffff:127\.|127\.)/.test(forwarded)) {
    warnedProxy = true;
    console.warn('AVISO: llegan peticiones con X-Forwarded-For pero TRUST_PROXY no está configurado en backend/.env; todos los clientes se verán con la IP del proxy.');
  }
  next();
});
// Para que el hospedaje (Railway u otro) sepa que el proceso sigue vivo. No revela nada del negocio.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Webhook de Mercado Pago: viene de sus servidores, no de un navegador, así que va ANTES de sameOriginOnly (una
// defensa pensada para peticiones de navegador). A diferencia de Stripe, la firma no se calcula sobre el cuerpo
// sino sobre el id de la notificación (?data.id= en la URL), el header x-request-id y un timestamp — así que el
// cuerpo sí se puede parsear como JSON normal (solo para esta ruta, antes del parser global de abajo).
app.post('/api/webhook/mercadopago', express.json({ limit: '20kb' }), async (req, res) => {
  const dataId = req.query['data.id'] || req.body?.data?.id;
  try {
    mercadopagoCheckout.verifyWebhookSignature({
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId,
    });
  } catch (err) {
    console.error('Webhook de Mercado Pago con firma inválida:', err.message);
    return res.status(400).send('Firma inválida.');
  }
  const type = req.query.type || req.body?.type;
  if (type === 'payment' && dataId) {
    try {
      // Nunca se confía en el cuerpo de la notificación (solo avisa "hay novedades"): el estado real del pago se
      // pide aparte, a la API, con el id que trajo.
      const payment = await mercadopagoCheckout.retrievePayment(dataId);
      const checkoutToken = payment.external_reference;
      const internalPayment = checkoutToken ? payments.getByCheckoutToken(checkoutToken) : null;
      if (!internalPayment) {
        console.error(`Webhook de Mercado Pago: pago ${dataId} sin external_reference reconocible (¿notificación de prueba?)`);
      } else if (payment.status === 'approved') {
        const payerName = [payment.payer?.first_name, payment.payer?.last_name].filter(Boolean).join(' ') || null;
        const result = await billing.confirm(internalPayment.reference, 'mercadopago', {
          email: payment.payer?.email || null,
          payerName,
        });
        // La pantalla de "pago exitoso" (el checkoutToken en la URL de vuelta) consulta esto para mostrar las credenciales.
        credentials.stash(checkoutToken, {
          username: result.user.username,
          name: result.user.name,
          created: result.created,
          password: result.created ? result.password : null,
          accessUntil: result.accessUntil,
        });
      }
      // Si no está "approved" (pending/rejected/in_process) no hay nada que activar todavía: con binary_mode
      // (mercadopago-checkout.js) no debería llegar "pending", pero por si Mercado Pago manda otra notificación
      // después con el estado final, no hace falta hacer nada especial aquí — simplemente no se activa nada ahora.
    } catch (err) {
      // Reintentar no siempre lo arregla (referencia ya confirmada, notificación de prueba con un data.id que no
      // existe). Se responde 200 de todos modos para que Mercado Pago no siga reintentando algo que no va a cambiar.
      console.error(`Webhook de Mercado Pago: no se pudo procesar data.id=${dataId}:`, err.message);
    }
  }
  // Mercado Pago solo necesita saber que se recibió (200 o 201); espera una respuesta rápida (hasta 22s).
  res.json({ received: true });
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
  // Solo cadenas, y `hasOwn` para que claves como "constructor" o "__proto__" no cuenten como una calidad.
  const isText = (value) => typeof value === 'string';
  if (downloadVideo && !(isText(videoQuality) && Object.hasOwn(VIDEO_QUALITY_MAP, videoQuality))) {
    errors.push('Calidad de video inválida.');
  }
  if (downloadAudio && !(isText(audioQuality) && AUDIO_QUALITY_SET.has(audioQuality))) {
    errors.push('Calidad de audio inválida.');
  }
  if (audioLang && !(isText(audioLang) && AUDIO_LANG_SET.has(audioLang))) {
    errors.push('Idioma de audio inválido.');
  }
  if (startTime && !(isText(startTime) && TIME_REGEX.test(startTime))) {
    errors.push('Formato de tiempo de inicio inválido.');
  }
  if (endTime && !(isText(endTime) && TIME_REGEX.test(endTime))) {
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

// Protección del servidor: nada de transmisiones en vivo (no terminan nunca), tope de tamaño y, si no se pidió un
// recorte, tope de duración. Un video que no cumple se salta y yt-dlp termina sin bajar nada (se avisa al cliente).
function guardArgs(config) {
  const filters = ['!is_live'];
  if (!config.startTime && !config.endTime) filters.push(`duration<=?${LIMITS.maxDurationMin * 60}`);
  return ['--match-filter', filters.join(' & '), '--max-filesize', LIMITS.maxFileSize, ...ytdlpStrategyArgs()];
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
    ...guardArgs(config),
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
    ...guardArgs(config),
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

// Procesos de yt-dlp en marcha (cada uno en su propio grupo, para poder matarlo junto con ffmpeg).
const activeChildren = new Set();

function killTree(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

// Síntomas de que el problema es de YouTube o de yt-dlp (no del enlace del cliente): bloqueo, yt-dlp desactualizado...
const SERVICE_FAILURE = /sign in|precondition|unable to extract|http error 4(03|29)|requested format is not available/i;

// Error con un mensaje apto para el cliente (`publicMessage`) y el texto técnico original (`raw`) solo para el registro.
// `service` marca los fallos del servicio (ver SERVICE_FAILURE), que se vigilan en health.js.
const jobError = (publicMessage, raw = publicMessage, service = false) => Object.assign(new Error(publicMessage), { publicMessage, raw, service });

// Traduce lo que dijo yt-dlp a un mensaje para el cliente: sin rutas del servidor ni texto técnico.
function customerMessage(output) {
  if (/does not pass filter/i.test(output)) {
    return `Este video es una transmisión en vivo o dura más de ${LIMITS.maxDurationMin} min. Usa el recorte por tiempo para bajar solo un fragmento.`;
  }
  if (/larger than max-filesize/i.test(output)) {
    return `El archivo pesa más de ${LIMITS.maxFileSize.replace(/G$/, ' GB')}. Prueba con una calidad menor o recorta un fragmento.`;
  }
  if (SERVICE_FAILURE.test(output)) {
    return 'YouTube bloqueó la descarga por un momento. Inténtalo de nuevo en unos minutos; si sigue igual, avísanos.';
  }
  if (/private video|members[- ]only|join this channel/i.test(output)) return 'Este video es privado o es solo para miembros.';
  if (/video unavailable|has been removed|no longer available|not available in your country|does not exist/i.test(output)) return 'Este video no está disponible.';
  return 'No se pudo descargar este video. Revisa el enlace e inténtalo de nuevo.';
}

function runYtDlp(args, job, stageLabel) {
  return new Promise((resolve, reject) => {
    job.stage = stageLabel;
    job.percent = 0;

    const before = snapshotDir(job.dir);
    const child = spawn('yt-dlp', args, { detached: true });
    activeChildren.add(child);
    let output = ''; // cola de lo que dijo yt-dlp (para explicar por qué falló)
    const keep = (chunk) => {
      output = (output + chunk).slice(-4000);
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, LIMITS.jobTimeoutMs);
    const finish = () => {
      clearTimeout(timer);
      activeChildren.delete(child);
    };

    child.stdout.on('data', (chunk) => {
      keep(chunk);
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;

        const progressMatch = line.match(/\[download\]\s+(\d{1,3}(?:\.\d+)?)%/);
        if (progressMatch) {
          job.percent = Math.min(100, Math.round(parseFloat(progressMatch[1])));
        }
      }
    });

    child.stderr.on('data', keep);

    child.on('error', (err) => {
      finish();
      reject(jobError('El servicio de descargas no está disponible ahora mismo. Avísanos para arreglarlo.', `No se pudo ejecutar yt-dlp: ${err.message}`, true));
    });

    child.on('close', (code) => {
      finish();
      if (timedOut) return reject(jobError('La descarga tardó demasiado y se canceló. Prueba con otra calidad o recorta un fragmento.', 'timeout'));
      if (code !== 0) return reject(jobError(customerMessage(output), output.trim() || `yt-dlp finalizó con código ${code}`, SERVICE_FAILURE.test(output)));
      // Los archivos que quedan en disco al terminar la etapa son el
      // resultado final; yt-dlp ya limpió los fragmentos intermedios
      // (streams separados de audio/video antes de fusionarlos, etc.).
      const created = [...snapshotDir(job.dir)].filter((name) => !before.has(name) && !job.files.includes(name));
      // yt-dlp termina bien (código 0) aunque se salte el video por el filtro o el tope de tamaño: sin archivo nuevo no hubo descarga.
      if (created.length === 0) return reject(jobError(customerMessage(output), output.trim() || 'yt-dlp no generó ningún archivo'));
      job.files.push(...created);
      job.percent = 100;
      resolve();
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
    audit.log('download_done', { userId: job.userId, jobId, files: job.files.length });
    health.recordSuccess();
  } catch (err) {
    job.status = 'error';
    job.stage = null;
    job.message = 'No se pudo descargar el video.';
    job.error = err.publicMessage || 'No se pudo descargar este video. Revisa el enlace e inténtalo de nuevo.';
    audit.log('download_error', { userId: job.userId, jobId, error: String(err.raw || err.message).slice(-300) });
    if (err.service) health.recordServiceFailure(String(err.raw || err.message).slice(-200));
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

// El registro de actividad se limpia una vez al día (y al arrancar).
setInterval(() => audit.purgeOld(), 24 * 60 * 60 * 1000).unref();

// Al apagar el backend no queda nada en disco.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of activeChildren) killTree(child);
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

  // El intento se anota antes de verificar la contraseña (ver beginAttempt): así una ráfaga simultánea no se cuela.
  const attempt = auth.beginAttempt(req.ip, username);
  if (attempt.wait > 0) {
    res.setHeader('Retry-After', String(attempt.wait));
    return res.status(429).json({
      error: `Demasiados intentos. Vuelve a intentarlo en ${Math.ceil(attempt.wait / 60)} min.`,
      retryAfter: attempt.wait,
    });
  }

  const user = await auth.authenticate(username, password);
  if (!user) {
    return res.status(401).json({ error: 'El usuario o la contraseña no son correctos.' });
  }

  // Credenciales correctas: no cuenta como intento fallido.
  attempt.forgive();
  auth.clearFailures(req.ip, username);

  // Las credenciales son correctas, pero la cuenta está bloqueada o el acceso venció: no se abre sesión.
  if (user.status === 'banned') {
    return res.status(403).json({ error: auth.bannedMessage(), code: 'banned' });
  }
  if (auth.isExpired(user)) {
    return res.status(403).json({ error: auth.expiredMessage(user), code: 'access_expired' });
  }

  auth.setSessionCookie(req, res, user);
  audit.log('login', { userId: user.id, username: user.username, ip: req.ip });
  res.json({ user: auth.publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  auth.closeCurrentSession(req);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const result = auth.resolveSession(req);
  if (!result.user) return res.status(result.status).json(result.body);
  res.json({ user: auth.publicUser(result.user) });
});

// Genera una contraseña nueva para la cuenta con la que ya iniciaste sesión (equivalente al viejo "/recuperar" del
// bot, pero solo sirve si todavía puedes entrar). Cierra las demás sesiones abiertas; esta se queda activa.
app.post('/api/account/reset-password', auth.requireAuth, async (req, res) => {
  const password = auth.generatePassword();
  await auth.setPassword(req.user.id, password);
  auth.revokeUserSessions(req.user.id, auth.currentSid(req));
  audit.log('password_reset', { userId: req.user.id, username: req.user.username, by: 'self' });
  res.json({ password });
});

// ---------------------------------------------------------------------------
// Compra (pública: no hace falta haber iniciado sesión — es justo cómo se crea la cuenta)
// ---------------------------------------------------------------------------

// Tope simple por IP: crear una preferencia de pago por cada clic es normal, pero no cientos por minuto.
const checkoutHits = new Map();
function checkoutAllowed(ip) {
  const now = Date.now();
  const recent = (checkoutHits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  checkoutHits.set(ip, recent);
  return recent.length <= 10;
}

// Crea la referencia interna y la preferencia de pago, y manda al navegador derecho a Mercado Pago. El nombre, el
// correo y los datos de la tarjeta los recoge el propio Mercado Pago en su checkout hospedado; aceptar los
// términos se confirma en el propio sitio, antes de llamar a esto (ver Landing.jsx).
app.post('/api/checkout', async (req, res) => {
  if (!checkoutAllowed(req.ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera un momento.' });
  if (!mercadopagoCheckout.enabled) return res.status(503).json({ error: 'Las compras no están disponibles por ahora.' });
  const { plan, acceptedTerms } = req.body || {};
  if (!Object.hasOwn(PLANS, plan)) return res.status(400).json({ error: 'Plan inválido.' });
  if (acceptedTerms !== true) return res.status(400).json({ error: 'Debes aceptar los términos para continuar.' });

  const payment = payments.create({ plan, termsAcceptedAt: new Date().toISOString() });
  try {
    const preference = await mercadopagoCheckout.createPreference({ checkoutToken: payment.checkoutToken, plan });
    audit.log('checkout_started', { reference: payment.reference, plan, ip: req.ip });
    res.json({ url: preference.init_point });
  } catch (err) {
    console.error('No se pudo crear la preferencia de Mercado Pago:', err.message);
    payments.update(payment.reference, { status: 'cancelled', cancelledAt: new Date().toISOString() });
    res.status(502).json({ error: 'No se pudo iniciar el pago. Inténtalo de nuevo en un momento.' });
  }
});

// La pantalla de "pago exitoso" pregunta esto con el checkoutToken que se puso en la URL de vuelta, hasta que el
// webhook (que puede tardar unos segundos) ya haya activado la cuenta. checkoutToken es un id largo y al azar
// (payments.js): nadie más que quien acaba de pagar (y trae el enlace de vuelta) lo conoce.
app.get('/api/checkout-status/:checkoutToken', (req, res) => {
  const entry = credentials.peek(req.params.checkoutToken);
  if (!entry) return res.json({ ready: false });
  const { username, name, created, password, accessUntil } = entry;
  res.json({ ready: true, username, name, created, password, accessUntil });
});

// El recibo, descargable desde la pantalla de "pago exitoso" con el mismo checkoutToken (nadie más lo conoce).
app.get('/api/receipt/:checkoutToken', async (req, res) => {
  const payment = payments.getByCheckoutToken(req.params.checkoutToken);
  if (!payment || payment.status !== 'paid') return res.status(404).json({ error: 'Recibo no encontrado.' });
  const pdf = await buildReceipt(payment, 'paid');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="recibo-${payment.reference}.pdf"`);
  res.send(pdf);
});

app.use('/api/admin', adminRouter);

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

  // Capacidad del servidor. Esto no es abuso del cliente, así que no cuenta como descarga ni como choque con un límite.
  const running = [...jobs.values()].filter((job) => job.status === 'running');
  if (req.user.role !== 'admin' && running.filter((job) => job.userId === req.user.id).length >= LIMITS.maxJobsPerUser) {
    res.setHeader('Retry-After', '30');
    return res.status(429).json({ error: `Ya tienes ${LIMITS.maxJobsPerUser} descargas en curso. Espera a que terminen para pedir otra.`, code: 'busy' });
  }
  if (running.length >= LIMITS.maxConcurrentJobs) {
    res.setHeader('Retry-After', '30');
    return res.status(503).json({ error: 'Hay muchas descargas en curso. Inténtalo de nuevo en un minuto.', code: 'server_busy' });
  }

  // Protecciones anti-abuso: calidad del plan, 5 por minuto, tope diario y bloqueo automático.
  const denied = limits.checkDownload(req.user, { height: req.body.downloadVideo ? VIDEO_QUALITY_MAP[req.body.videoQuality] : 0, ip: req.ip });
  if (denied) {
    if (denied.retryAfter) res.setHeader('Retry-After', String(denied.retryAfter));
    return res.status(denied.status).json(denied.body);
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

  audit.log('download_start', {
    userId: req.user.id,
    username: req.user.username,
    plan: req.user.plan,
    jobId,
    ip: req.ip,
    url: req.body.url.trim().slice(0, 300),
    video: Boolean(req.body.downloadVideo),
    audio: Boolean(req.body.downloadAudio),
    thumbnail: Boolean(req.body.downloadThumbnail),
    quality: req.body.downloadVideo ? req.body.videoQuality : null,
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

// Un solo servicio (p. ej. Railway, sin nginx delante): si existe el frontend ya compilado (dist/, junto al
// proyecto), este backend también lo sirve. En desarrollo (Vite en :5174) esa carpeta no existe y esto no hace nada.
const DIST_DIR = process.env.DUOKIT_DIST_DIR || path.join(__dirname, '..', 'dist');
if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  app.use(express.static(DIST_DIR, { index: false }));
  // Cualquier ruta que no sea de la API cae en el index.html (rutas de la SPA: /app, /admin, /legal...).
  app.get(/^(?!\/api\/|\/downloads\/).*/, (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

// Errores: siempre JSON y sin detalles internos (rutas, pila de llamadas).
app.use((req, res) => res.status(404).json({ error: 'No encontrado.' }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Error interno del servidor.' : 'Solicitud no válida.' });
});

app.listen(PORT, HOST, () => {
  console.log(`Backend de yt-dlp escuchando en http://${HOST}:${PORT}`);
  console.log(`Archivos temporales (se borran solos): ${JOBS_ROOT}`);
  if (!mercadopagoCheckout.enabled) console.log('Mercado Pago desactivado: falta MERCADOPAGO_ACCESS_TOKEN en backend/.env (las compras no funcionarán).');
  else if (!config.MERCADOPAGO_WEBHOOK_SECRET) console.log('AVISO: falta MERCADOPAGO_WEBHOOK_SECRET — los pagos se podrán iniciar pero nunca se confirmarán solos (el webhook siempre fallará la firma). Usa /admin para confirmar a mano mientras tanto.');
});
