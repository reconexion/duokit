// Pagos con tarjeta por Mercado Pago Checkout Pro. Cada compra genera una referencia interna única: DUO-2026-001,
// DUO-2026-002... El pago se crea "pending" al abrir el checkout (todavía sin correo ni nombre: eso lo da Mercado
// Pago) y queda "paid" cuando el webhook confirma que se aprobó (o, de emergencia, si el administrador lo confirma
// a mano con /confirmar).
const crypto = require('crypto');
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
// El webhook de Mercado Pago trae el checkoutToken como external_reference del pago, así que normalmente no hace
// falta esto; sirve de respaldo y para que /api/checkout-status y /api/receipt encuentren el pago por su token.
const getByCheckoutToken = (checkoutToken) => read().find((p) => p.checkoutToken === checkoutToken) || null;

// Se crea al abrir el checkout, antes de saber quién es el cliente (Mercado Pago todavía no ha recogido su correo
// ni su nombre): email/payerName llegan después, con confirm() (billing.js), cuando el webhook trae esos datos.
// checkoutToken es un id aparte, largo y al azar — a diferencia de `reference` (secuencial, DUO-2026-NNN, por tanto
// adivinable), nadie más que quien acaba de pagar lo conoce: es lo que viaja en la URL de vuelta y en
// external_reference de la preferencia (ver mercadopago-checkout.js).
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
    checkoutToken: crypto.randomUUID(),
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

module.exports = { create, get, list, update, revenue, normalizeReference, getByCheckoutToken };
