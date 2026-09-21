// Protecciones anti-abuso para las descargas: límite del plan, 5 por minuto, tope diario por plan
// y bloqueo automático si alguien insiste en pasarse de los límites.
const audit = require('./audit');
const auth = require('./auth');
const billing = require('./billing');
const { LIMITS, planOf, money } = require('./plans');

// Choques seguidos con el mismo límite cuentan como uno solo: dentro del mismo minuto para el tope por minuto y dentro de
// la misma hora para el tope diario (un cliente honesto que ya agotó sus descargas y sigue probando no debe quedar bloqueado).
const STRIKE_GAP_MS = {
  per_minute: Number(process.env.DUOKIT_STRIKE_GAP_MS ?? 60 * 1000),
  per_day: Number(process.env.DUOKIT_DAILY_STRIKE_GAP_MS ?? 60 * 60 * 1000),
};

// Anota que el usuario chocó con un límite y lo bloquea si ya son demasiados en 24 h.
function registerStrike(user, kind, ip) {
  if (Date.now() - audit.lastStrikeAt(user.id, kind) >= STRIKE_GAP_MS[kind]) {
    audit.log('limit_exceeded', { userId: user.id, username: user.username, kind, ip });
  }
  if (audit.strikesLast24h(user.id) < LIMITS.strikesToBan) return false;

  auth.banUser(user.id, 'Bloqueo automático: superó los límites de uso');
  audit.log('auto_ban', { userId: user.id, username: user.username, ip });
  const notifier = billing.getNotifier();
  notifier?.notifyAdmin(`🚫 Bloqueo automático: ${user.username} superó los límites de uso ${LIMITS.strikesToBan} veces en 24 h. Puedes desbloquearlo desde /admin.`);
  if (user.telegramId) notifier?.notifyUser(user.telegramId, `Tu cuenta de duokit fue suspendida por superar los límites de uso. Escribe a @tostilocos si crees que fue un error.`);
  return true;
}

// Devuelve null si puede descargar, o { status, body, retryAfter? } con el motivo del rechazo.
function checkDownload(user, { height = 0, ip } = {}) {
  const plan = planOf(user);

  if (height > plan.maxHeight) {
    return {
      status: 403,
      body: { error: `Tu plan ${plan.name} permite video hasta ${plan.qualityLabel}. Con el plan Permanente puedes bajar en 2K y 4K.`, code: 'plan_limit' },
    };
  }
  if (user.role === 'admin') return null;

  let violation = null;
  if (audit.downloadsInLastMinute(user.id) >= LIMITS.perMinute) {
    violation = {
      kind: 'per_minute',
      status: 429,
      retryAfter: 60,
      body: { error: `Vas muy rápido: el máximo es ${LIMITS.perMinute} descargas por minuto. Espera un momento e inténtalo de nuevo.`, code: 'rate_limit' },
    };
  } else if (audit.downloadsToday(user.id) >= plan.dailyLimit) {
    violation = {
      kind: 'per_day',
      status: 429,
      body: { error: `Llegaste al límite de ${plan.dailyLimit} descargas de hoy (plan ${plan.name}). Se reinicia a medianoche.`, code: 'daily_limit' },
    };
  }
  if (!violation) return null;

  if (registerStrike(user, violation.kind, ip)) {
    return { status: 403, body: { error: auth.bannedMessage(), code: 'banned' } };
  }
  return violation;
}

module.exports = { checkDownload, money };
