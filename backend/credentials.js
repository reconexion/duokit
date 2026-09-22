// Guarda un rato el usuario/contraseña recién creados (o "tu acceso se renovó") para que la pantalla de "pago
// exitoso" los muestre, apenas el webhook de Stripe confirma el pago. No se guarda en disco — la contraseña real
// solo existe en texto plano hasta que se hashea (ver auth.js) — es solo el ratito entre el webhook y esa pantalla.
// La llave es el id de la sesión de Stripe: es del propio Stripe, larga y al azar, así que sirve como "token" sin
// necesidad de inventar uno aparte (nadie más la conoce salvo quien acaba de pagar y trae el enlace de vuelta).
const TTL_MS = 15 * 60 * 1000; // 15 min: de sobra para que la pestaña cargue, pero no se queda ahí para siempre
const store = new Map(); // stripeSessionId -> { ...datos, expiresAt }

function stash(sessionId, data) {
  store.set(sessionId, { ...data, expiresAt: Date.now() + TTL_MS });
}

// Se puede pedir varias veces dentro del plazo (por si la pestaña reintenta o se recarga antes de que la persona
// apunte la contraseña); no se borra al primer vistazo, solo cuando expira.
function peek(sessionId) {
  const entry = store.get(sessionId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(sessionId);
    return null;
  }
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) if (now > entry.expiresAt) store.delete(key);
}, 60000).unref();

module.exports = { stash, peek };
