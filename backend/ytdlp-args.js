// Arma los argumentos de yt-dlp para video/audio/miniatura. Lo usan tanto el servidor (server.js, con los trucos
// de bloqueo de IP de ytdlp-strategy.js) como el Asistente de escritorio (helper/, sin esos trucos: corre en la
// compu del cliente, con su propia IP normal, así que no le hace falta ningún player_client/proxy/cookies).
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
  const { url, downloadVideo, downloadAudio, downloadThumbnail, videoQuality, audioQuality, audioLang, startTime, endTime } = body;

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

// Nada de transmisiones en vivo (no terminan nunca), tope de tamaño y, si no se pidió un recorte, tope de
// duración. Un video que no cumple se salta y yt-dlp termina sin bajar nada (se avisa al cliente).
// `limits` = { maxDurationMin, maxFileSize } (de plans.js en el servidor; el Asistente trae los mismos valores
// horneados, ver helper/index.js). `extraArgs` son los trucos de bloqueo de IP (solo el servidor los necesita).
function guardArgs(config, limits, extraArgs = []) {
  const filters = ['!is_live'];
  if (!config.startTime && !config.endTime) filters.push(`duration<=?${limits.maxDurationMin * 60}`);
  return ['--match-filter', filters.join(' & '), '--max-filesize', limits.maxFileSize, ...extraArgs];
}

function buildVideoArgs(config, limits, extraArgs = []) {
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
    ...guardArgs(config, limits, extraArgs),
    ...buildSectionArgs(config.startTime, config.endTime),
  ];
}

function buildAudioArgs(config, limits, extraArgs = []) {
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
    ...guardArgs(config, limits, extraArgs),
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

module.exports = {
  TIME_REGEX,
  VIDEO_QUALITY_MAP,
  AUDIO_QUALITY_SET,
  AUDIO_LANG_SET,
  isYouTubeUrl,
  validatePayload,
  buildSectionArgs,
  audioSelector,
  guardArgs,
  buildVideoArgs,
  buildAudioArgs,
  buildThumbnailArgs,
};
