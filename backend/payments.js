// Pagos por transferencia (SPEI). Cada compra genera una referencia única: DUO-2026-001, DUO-2026-002...
// El pago queda "pending" hasta que el administrador confirma que llegó la transferencia.
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

// Lo que el cliente escribe en el concepto de la transferencia: la referencia y su nombre ("DUO-2026-001 MARIA LOPEZ"),
// para reconocerlo de un vistazo en el estado de cuenta. Los bancos suelen aceptar en el concepto solo letras y números
// sin acentos y hasta 40 caracteres, así que el nombre se normaliza y el conjunto se recorta a ese largo.
// La referencia en sí (DUO-AAAA-NNN) no cambia: es el identificador que usan los botones y /confirmar.
function paymentConcept(payment) {
  const name = String(payment.payerName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${payment.reference} ${name}`.trim().slice(0, 40).trim();
}

const get = (reference) => read().find((p) => p.reference === normalizeReference(reference)) || null;
const list = () => read();

// Si la persona ya tiene un pago pendiente del mismo plan, se reutiliza (así no se acumulan referencias).
function create({ plan, telegramId, telegramUsername, telegramName, payerName, termsAcceptedAt }) {
  const all = read();
  const existing = all.find((p) => p.status === 'pending' && p.telegramId === String(telegramId) && p.plan === plan);
  // Si ya tenía una referencia pendiente del mismo plan, se reutiliza (no se duplica), pero se refresca la fecha de
  // aceptación: acaba de volver a tocar "Acepto los términos" para esta misma compra.
  if (existing) return { payment: termsAcceptedAt ? update(existing.reference, { termsAcceptedAt }) : existing, reused: true };
  const payment = {
    reference: nextReference(all),
    plan,
    amount: PLANS[plan].price,
    status: 'pending', // pending | paid | cancelled
    telegramId: String(telegramId),
    telegramUsername: telegramUsername || null,
    telegramName: telegramName || null,
    payerName: payerName || null, // nombre real que dio el cliente: sirve para reconocer la transferencia en el banco
    createdAt: new Date().toISOString(),
    reportedAt: null, // cuando la persona dijo "ya pagué"
    confirmedAt: null,
    cancelledAt: null,
    userId: null,
    username: null,
    accessUntil: null,
    termsAcceptedAt: termsAcceptedAt || null, // cuándo tocó "Acepto los términos" antes de generar esta referencia
  };
  write([...all, payment]);
  return { payment, reused: false };
}

function update(reference, patch) {
  const all = read();
  const payment = all.find((p) => p.reference === normalizeReference(reference));
  if (!payment) return null;
  Object.assign(payment, patch);
  write(all);
  return payment;
}

// Último nombre que la persona dio en una compra anterior (así no se lo pedimos otra vez).
const knownName = (telegramId) => read().filter((p) => p.telegramId === String(telegramId) && p.payerName).at(-1)?.payerName || null;

const revenue = () => read().filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0);

module.exports = { create, get, list, update, revenue, knownName, normalizeReference, paymentConcept };
