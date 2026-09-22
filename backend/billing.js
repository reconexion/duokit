// Activación de cuentas al confirmar un pago (por Mercado Pago, o a mano de emergencia). Crea el usuario (o renueva
// el existente) según el correo que Mercado Pago recogió al cobrar — es el único identificador estable que tenemos
// del cliente ahora que no hay Telegram.
const auth = require('./auth');
const audit = require('./audit');
const payments = require('./payments');
const { PLANS } = require('./plans');

const pad = (n) => String(n).padStart(2, '0');
const toDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const parseDay = (value) => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// Renueva sumando los días al final del acceso vigente (o desde hoy si ya venció).
function newExpiry(user, plan) {
  if (plan.days === null) return null;
  const today = new Date();
  const base = user?.expiresAt && !auth.isExpired(user) ? parseDay(user.expiresAt) : today;
  return toDay(addDays(base, plan.days));
}

// Las confirmaciones se hacen de una en una: cada una lee y escribe usuarios y pagos, y un doble webhook (o dos
// pagos confirmados a la vez desde /admin) no debe pisar a la otra. La segunda espera y ve el estado ya actualizado.
let queue = Promise.resolve();
const serialized = (task) => {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
};

async function activate(payment) {
  const plan = PLANS[payment.plan];
  let user = payment.email ? auth.findUserByEmail(payment.email) : null;
  if (user?.status === 'banned') throw new Error('Esta cuenta está bloqueada. Desbloquéala antes de confirmar el pago.');

  // Quien ya tiene acceso permanente no pierde nada al comprar otro plan.
  if (user && user.plan === 'lifetime' && plan.id !== 'lifetime') return { user, created: false, password: null, accessUntil: null };

  const accessUntil = newExpiry(user, plan);
  if (user) {
    user = auth.updateUser(user.id, { plan: plan.id, expiresAt: accessUntil });
    return { user, created: false, password: null, accessUntil };
  }
  const password = auth.generatePassword();
  const username = auth.uniqueUsername(payment.payerName || payment.email?.split('@')[0] || 'duo');
  user = await auth.addUser({
    username,
    name: payment.payerName || username,
    password,
    plan: plan.id,
    expiresAt: accessUntil,
    email: payment.email,
  });
  return { user, created: true, password, accessUntil };
}

// Confirma un pago pendiente: activa la cuenta. `extra` (email, payerName) es lo que Mercado Pago recogió al cobrar —
// solo lo trae el webhook; una confirmación manual de emergencia (/confirmar) no tiene nada que darle.
const confirm = (reference, by = 'admin', extra = {}) => serialized(() => confirmNow(reference, by, extra));

async function confirmNow(reference, by, extra) {
  const ref = payments.normalizeReference(reference);
  let payment = payments.get(ref);
  if (!payment) throw new Error(`No existe el pago ${ref}.`);
  if (payment.status !== 'pending') throw new Error(`El pago ${ref} ya está ${payment.status === 'paid' ? 'confirmado' : 'cancelado'}.`);

  if (extra.email || extra.payerName) {
    payment = payments.update(ref, { email: extra.email || payment.email, payerName: extra.payerName || payment.payerName });
  }

  const { user, created, password, accessUntil } = await activate(payment);
  const confirmed = payments.update(ref, {
    status: 'paid',
    confirmedAt: new Date().toISOString(),
    confirmedBy: by,
    userId: user.id,
    username: user.username,
    accessUntil,
  });
  audit.log('payment_confirmed', { reference: ref, userId: user.id, username: user.username, amount: payment.amount, plan: payment.plan, by });

  return { payment: confirmed, user, created, password, accessUntil };
}

function cancel(reference) {
  const ref = payments.normalizeReference(reference);
  const payment = payments.get(ref);
  if (!payment) throw new Error(`No existe el pago ${ref}.`);
  if (payment.status !== 'pending') throw new Error(`El pago ${ref} ya no está pendiente.`);
  audit.log('payment_cancelled', { reference: ref });
  return payments.update(ref, { status: 'cancelled', cancelledAt: new Date().toISOString() });
}

module.exports = { confirm, cancel };
