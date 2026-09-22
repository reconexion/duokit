// Vigila que las descargas funcionen. Si varias fallan seguidas por culpa de YouTube o de yt-dlp (no del enlace del
// cliente), lo marca como alerta activa: es el síntoma típico de que yt-dlp quedó desactualizado. Sin Telegram no
// hay a quién avisarle en el momento, así que el panel de admin (`/admin`) muestra si hay una alerta activa —
// revísalo de vez en cuando, o pregunta /api/admin/summary.
const audit = require('./audit');

const THRESHOLD = 3; // fallos seguidos antes de marcar la alerta
const COOLDOWN_MS = 60 * 60 * 1000; // no repetir el registro más de una vez por hora mientras siga fallando

let streak = 0;
let lastAlertAt = 0;
let active = null; // { since, detail } mientras la alerta sigue sin resolverse

function recordServiceFailure(detail) {
  streak += 1;
  if (streak < THRESHOLD) return;
  if (!active) active = { since: new Date().toISOString(), detail };
  else active.detail = detail;
  if (Date.now() - lastAlertAt < COOLDOWN_MS) return;
  lastAlertAt = Date.now();
  audit.log('service_alert', { streak, detail });
}

function recordSuccess() {
  streak = 0;
  active = null;
}

// Para el panel de administración: null si todo va bien.
const status = () => active;

module.exports = { recordServiceFailure, recordSuccess, status };
