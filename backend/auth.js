// Autenticación: usuarios en un archivo JSON (sin registro público), contraseñas
// con scrypt y sesión en una cookie httpOnly firmada con HMAC. Solo usa `crypto`.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

const COOKIE_NAME = 'duokit_session';
const SESSION_HOURS = 24;

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function writeUsers(users) {
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
}

const normalizeUsername = (username) => String(username || '').trim().toLowerCase();

// 3 a 32 caracteres: letras, números, punto, guion y guion bajo (siempre en minúsculas).
const USERNAME_REGEX = /^[a-z0-9._-]{3,32}$/;

// Vencimiento del acceso: "AAAA-MM-DD" = último día en que el usuario puede entrar (hasta las 23:59, hora del servidor).
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (!DATE_REGEX.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// Primer instante en que el acceso ya no vale: la medianoche siguiente al último día.
function accessEndsAt(expiresAt) {
  const [y, m, d] = expiresAt.split('-').map(Number);
  return new Date(y, m - 1, d + 1).getTime();
}

const isExpired = (user) => Boolean(user.expiresAt) && Date.now() >= accessEndsAt(user.expiresAt);

function formatDate(expiresAt) {
  const [y, m, d] = expiresAt.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

const expiredMessage = (user) => `Tu acceso a duokit venció el ${formatDate(user.expiresAt)}. Pide que lo renueven.`;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Hash de relleno: se compara aunque el usuario no exista, para que responder
// "no existe" no sea más rápido que responder "contraseña incorrecta".
const DUMMY_HASH_PROMISE = hashPassword(crypto.randomBytes(16).toString('hex'));

async function addUser({ username, name, password, expiresAt = null }) {
  const users = readUsers();
  const normalized = normalizeUsername(username);
  if (!USERNAME_REGEX.test(normalized)) throw new Error('Usuario no válido.');
  if (!String(name || '').trim()) throw new Error('El nombre es obligatorio.');
  if (expiresAt !== null && !isValidDate(expiresAt)) throw new Error('La fecha de vencimiento debe ser AAAA-MM-DD.');
  if (users.some((u) => u.username === normalized)) throw new Error('Ya existe ese nombre de usuario.');
  const user = {
    id: crypto.randomUUID(),
    username: normalized,
    name: String(name).trim(),
    passwordHash: await hashPassword(password),
    expiresAt, // null = sin vencimiento
    createdAt: new Date().toISOString(),
  };
  writeUsers([...users, user]);
  return user;
}

function removeUser(username) {
  const users = readUsers();
  const normalized = normalizeUsername(username);
  const next = users.filter((u) => u.username !== normalized);
  if (next.length === users.length) return false;
  writeUsers(next);
  return true;
}

// Cambia (o quita, con null) la fecha límite de acceso de un usuario.
function setExpiry(username, expiresAt) {
  if (expiresAt !== null && !isValidDate(expiresAt)) throw new Error('La fecha de vencimiento debe ser AAAA-MM-DD.');
  const users = readUsers();
  const user = users.find((u) => u.username === normalizeUsername(username));
  if (!user) return false;
  user.expiresAt = expiresAt;
  writeUsers(users);
  return true;
}

function listUsers() {
  return readUsers().map((u) => ({ id: u.id, username: u.username, name: u.name, createdAt: u.createdAt, expiresAt: u.expiresAt || null, expired: isExpired(u) }));
}

const publicUser = ({ id, username, name, expiresAt }) => ({ id, username, name, expiresAt: expiresAt || null });

async function authenticate(username, password) {
  const user = readUsers().find((u) => u.username === normalizeUsername(username));
  const ok = await verifyPassword(password, user ? user.passwordHash : await DUMMY_HASH_PROMISE);
  return user && ok ? user : null;
}

// ---------------------------------------------------------------------------
// Sesión (token firmado)
// ---------------------------------------------------------------------------

function loadSecret() {
  try {
    return fs.readFileSync(SECRET_FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const secret = crypto.randomBytes(32);
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
}

const SECRET = loadSecret();
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function createToken(userId, ttlMs) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + ttlMs })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return cookies;
}

function setSessionCookie(req, res, userId) {
  // Cookie de sesión: se borra al cerrar el navegador y, aunque no se cierre, el token vence en SESSION_HOURS.
  const attrs = [`${COOKIE_NAME}=${createToken(userId, SESSION_HOURS * 3600000)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function currentUser(req) {
  const data = readToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  if (!data) return null;
  return readUsers().find((u) => u.id === data.uid) || null;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  if (isExpired(user)) return res.status(401).json({ error: expiredMessage(user), code: 'access_expired' });
  req.user = user;
  next();
}

// Las peticiones que cambian algo deben venir del mismo sitio (defensa extra sobre SameSite).
function sameOriginOnly(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    // Detrás del proxy de Vite el `Host` es el del backend; el original llega en x-forwarded-host.
    const allowed = [req.headers.host, req.headers['x-forwarded-host']];
    if (!allowed.includes(host)) return res.status(403).json({ error: 'Origen no permitido.' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Límite de intentos fallidos (en memoria)
// ---------------------------------------------------------------------------

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_ACCOUNT = 5;
const MAX_FAILS_PER_IP = 20;
const failures = new Map();

function recentFailures(key) {
  const now = Date.now();
  const list = (failures.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

function retryAfterSeconds(ip, username) {
  const checks = [
    [`acct:${ip}:${normalizeUsername(username)}`, MAX_FAILS_PER_ACCOUNT],
    [`ip:${ip}`, MAX_FAILS_PER_IP],
  ];
  for (const [key, max] of checks) {
    const list = recentFailures(key);
    if (list.length >= max) return Math.ceil((list[0] + WINDOW_MS - Date.now()) / 1000);
  }
  return 0;
}

function registerFailure(ip, username) {
  for (const key of [`acct:${ip}:${normalizeUsername(username)}`, `ip:${ip}`]) {
    failures.set(key, [...recentFailures(key), Date.now()]);
  }
}

function clearFailures(ip, username) {
  failures.delete(`acct:${ip}:${normalizeUsername(username)}`);
}

module.exports = {
  USERNAME_REGEX,
  isValidDate,
  isExpired,
  expiredMessage,
  setExpiry,
  addUser,
  removeUser,
  listUsers,
  authenticate,
  publicUser,
  requireAuth,
  sameOriginOnly,
  currentUser,
  setSessionCookie,
  clearSessionCookie,
  retryAfterSeconds,
  registerFailure,
  clearFailures,
  normalizeUsername,
};
