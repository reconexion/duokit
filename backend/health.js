// Vigila que las descargas funcionen. Si varias fallan seguidas por culpa de YouTube o de yt-dlp (no del enlace del
// cliente), avisa al administrador por Telegram: es el síntoma típico de que yt-dlp quedó desactualizado.
const audit = require('./audit');
const billing = require('./billing');

const THRESHOLD = 3; // fallos seguidos antes de avisar
const COOLDOWN_MS = 60 * 60 * 1000; // no repetir el aviso más de una vez por hora

let streak = 0;
let lastAlertAt = 0;
let alerted = false;

function recordServiceFailure(detail) {
  streak += 1;
  if (streak < THRESHOLD || Date.now() - lastAlertAt < COOLDOWN_MS) return;
  lastAlertAt = Date.now();
  alerted = true;
  audit.log('service_alert', { streak, detail });
  billing
    .getNotifier()
    ?.notifyAdmin(`⚠️ ${streak} descargas seguidas fallaron por YouTube/yt-dlp. Suele arreglarse actualizando: pipx upgrade yt-dlp\n\nÚltimo error: ${detail}`);
}

function recordSuccess() {
  streak = 0;
  if (!alerted) return;
  alerted = false;
  billing.getNotifier()?.notifyAdmin('✅ Las descargas vuelven a funcionar.');
}

module.exports = { recordServiceFailure, recordSuccess };
