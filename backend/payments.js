// Pagos con tarjeta por Stripe Checkout. Cada compra genera una referencia interna única: DUO-2026-001, DUO-2026-002...
// El pago se crea "pending" al abrir el checkout (todavía sin correo ni nombre: eso lo da Stripe) y queda "paid"
// cuando el webhook confirma que se completó (o, de emergencia, si el administrador lo confirma a mano con /confirmar).
const fs = require('fs');
const path = require('path');
const { PLANS } = require('./plans');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'payments.json');

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function write(list) {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

function nextReference(list) {
  const prefix = `DUO-${new Date().getFullYear()}-`;
  const last = list
    .filter((p) => p.reference.startsWith(prefix))
    .map((p) => Number(p.reference.slice(prefix.length)))
    .reduce((max, n) => Math.max(max, n), 0);
  return `${prefix}${String(last + 1).padStart(3, '0')}`;
}

const normalizeReference = (ref) => String(ref || '').trim().toUpperCase();

const get = (reference) => read().find((p) => p.reference === normalizeReference(reference)) || null;
const list = () => read();
// El webhook de Stripe lee la referencia directo de metadata, así que normalmente no hace falta esto; sirve como
// respaldo y para que el panel pueda mostrar a qué sesión de Stripe corresponde cada pago.
const getByStripeSession = (sessionId) => read().find((p) => p.stripeSessionId === sessionId) || null;

// Se crea al abrir el checkout, antes de saber quién es el cliente (Stripe todavía no ha recogido su correo ni su
// nombre): email/payerName llegan después, con confirm() (billing.js), cuando el webhook trae esos datos.
function create({ plan, termsAcceptedAt }) {
  const all = read();
  const payment = {
    reference: nextReference(all),
    plan,
    amount: PLANS[plan].price,
    status: 'pending', // pending | paid | cancelled
    email: null,
    payerName: null,
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    cancelledAt: null,
    userId: null,
    username: null,
    accessUntil: null,
    termsAcceptedAt: termsAcceptedAt || null, // cuándo aceptó los términos, antes de ir a pagar
    stripeSessionId: null, // se rellena después de crear la sesión de pago (payments.update)
  };
  write([...all, payment]);
  return payment;
}

function update(reference, patch) {
  const all = read();
  const payment = all.find((p) => p.reference === normalizeReference(reference));
  if (!payment) return null;
  Object.assign(payment, patch);
  write(all);
  return payment;
}

const revenue = () => read().filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0);

module.exports = { create, get, list, update, revenue, normalizeReference, getByStripeSession };
