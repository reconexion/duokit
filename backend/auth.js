// Autenticación: usuarios en un archivo JSON (sin registro público), contraseñas
// con scrypt y sesión en una cookie httpOnly firmada con HMAC. Solo usa `crypto`.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { LIMITS, planOf } = require('./plans');
const { SELLER } = require('./config');

const scrypt = promisify(crypto.scrypt);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const COOKIE_NAME = 'duokit_session';
const SESSION_HOURS = 24;

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

// Los usuarios creados antes de los planes se tratan como Básico, activos y sin correo.
const withDefaults = (u) => ({ role: 'user', plan: 'basic', status: 'active', email: null, ...u });

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).map(withDefaults);
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

async function addUser({ username, name, password, expiresAt = null, plan = 'basic', role = 'user', email = null }) {
  const normalized = normalizeUsername(username);
  if (!USERNAME_REGEX.test(normalized)) throw new Error('Usuario no válido.');
  if (!String(name || '').trim()) throw new Error('El nombre es obligatorio.');
  if (expiresAt !== null && !isValidDate(expiresAt)) throw new Error('La fecha de vencimiento debe ser AAAA-MM-DD.');
  const normalizedEmail = email === null ? null : normalizeEmail(email);
  if (normalizedEmail !== null && !EMAIL_REGEX.test(normalizedEmail)) throw new Error('El correo no es válido.');
  const passwordHash = await hashPassword(password);
  // Desde aquí no hay más `await`: leer y escribir la lista en el mismo turno evita pisar a otro usuario que se cree
  // (o un bloqueo/renovación que se guarde) mientras se calculaba el hash.
  const users = readUsers();
  if (users.some((u) => u.username === normalized)) throw new Error('Ya existe ese nombre de usuario.');
  if (normalizedEmail !== null && users.some((u) => u.email === normalizedEmail)) throw new Error('Ese correo ya tiene una cuenta.');
  const user = {
    id: crypto.randomUUID(),
    username: normalized,
    name: String(name).trim(),
    passwordHash,
    expiresAt, // null = sin vencimiento
    plan,
    role,
    status: 'active',
    email: normalizedEmail,
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
  return readUsers().map((u) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    plan: u.plan,
    status: u.status,
    email: u.email,
    createdAt: u.createdAt,
    expiresAt: u.expiresAt || null,
    expired: isExpired(u),
  }));
}

const findUserById = (id) => readUsers().find((u) => u.id === id) || null;
const findUserByEmail = (email) => readUsers().find((u) => u.email && u.email === normalizeEmail(email)) || null;

// Cambia campos de un usuario y devuelve el usuario ya actualizado (o null si no existe).
function updateUser(id, patch) {
  const users = readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  Object.assign(user, patch);
  writeUsers(users);
  return user;
}

async function setPassword(id, password) {
  return updateUser(id, { passwordHash: await hashPassword(password) });
}

// Bloquea a un usuario y cierra todas sus sesiones.
function banUser(id, reason) {
  const user = updateUser(id, { status: 'banned', bannedAt: new Date().toISOString(), banReason: reason || null });
  if (user) revokeUserSessions(id);
  return user;
}

const unbanUser = (id) => updateUser(id, { status: 'active', bannedAt: null, banReason: null });

// Nombre de usuario libre a partir de uno sugerido (p. ej. el nombre que dio al pagar).
function uniqueUsername(preferred) {
  const taken = new Set(readUsers().map((u) => u.username));
  // Quita los acentos antes de filtrar: "María López" -> "marialopez", no "maralpez".
  let base = normalizeUsername(preferred).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]/g, '').slice(0, 24);
  if (base.length < 3) base = `duo${crypto.randomInt(1000, 10000)}`;
  let candidate = base;
  while (taken.has(candidate)) candidate = `${base}${crypto.randomInt(100, 1000)}`;
  return candidate;
}

// Contraseña aleatoria sin caracteres que se confundan (0/O, 1/l/I).
function generatePassword(length = 14) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}

function publicUser(user) {
  const plan = planOf(user);
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    plan: plan.id,
    planName: plan.name,
    maxHeight: plan.maxHeight,
    qualityLabel: plan.qualityLabel,
    expiresAt: user.expiresAt || null,
  };
}

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

function createToken(userId, sid, ttlMs) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, sid, exp: Date.now() + ttlMs })).toString('base64url');
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
    if (i <= 0) continue;
    const raw = part.slice(i + 1).trim();
    try {
      cookies[part.slice(0, i).trim()] = decodeURIComponent(raw);
    } catch {
      cookies[part.slice(0, i).trim()] = raw; // valor mal codificado: se deja tal cual (no coincidirá con ninguna firma)
    }
  }
  return cookies;
}

// ---------------------------------------------------------------------------
// Registro de sesiones: permite limitar cuántas hay abiertas a la vez y cerrarlas desde el servidor.
// ---------------------------------------------------------------------------

function loadSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

let sessions = loadSessions().filter((x) => x.expiresAt > Date.now());
const replacedSessions = new Set(); // sesiones cerradas porque se abrió otra (para avisar por qué)

function saveSessions() {
  const tmp = `${SESSIONS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(sessions), { mode: 0o600 });
  fs.renameSync(tmp, SESSIONS_FILE);
}

function openSession(user, ttlMs) {
  const now = Date.now();
  sessions = sessions.filter((x) => x.expiresAt > now);
  const max = user.role === 'admin' ? LIMITS.adminMaxSessions : LIMITS.maxSessions;
  const mine = sessions.filter((x) => x.userId === user.id).sort((a, b) => a.createdAt - b.createdAt);
  // Al pasar del máximo se cierra la sesión más antigua: la que acaba de entrar siempre funciona.
  while (mine.length >= max) {
    const oldest = mine.shift();
    sessions = sessions.filter((x) => x.sid !== oldest.sid);
    replacedSessions.add(oldest.sid);
    if (replacedSessions.size > 1000) replacedSessions.clear();
  }
  const session = { sid: crypto.randomUUID(), userId: user.id, createdAt: now, expiresAt: now + ttlMs };
  sessions.push(session);
  saveSessions();
  return session;
}

function closeSession(sid) {
  const before = sessions.length;
  sessions = sessions.filter((x) => x.sid !== sid);
  if (sessions.length !== before) saveSessions();
}

// `exceptSid`: para cuando la propia sesión actual pide un cambio (p. ej. generar contraseña nueva) y no debe
// cerrarse a sí misma, solo las demás (así no expulsa a quien acaba de pedirlo).
function revokeUserSessions(userId, exceptSid = null) {
  sessions = sessions.filter((x) => x.userId !== userId || x.sid === exceptSid);
  saveSessions();
}

// El sid de la sesión de la petición actual (o null si no hay una válida). Sirve para "cerrar las demás, no esta".
function currentSid(req) {
  return readToken(parseCookies(req.headers.cookie)[COOKIE_NAME])?.sid || null;
}

const activeSessionCount = (userId) => sessions.filter((x) => x.userId === userId && x.expiresAt > Date.now()).length;

function setSessionCookie(req, res, user) {
  const ttlMs = SESSION_HOURS * 3600000;
  const session = openSession(user, ttlMs);
  // Cookie de sesión: se borra al cerrar el navegador y, aunque no se cierre, el token vence en SESSION_HOURS.
  const attrs = [`${COOKIE_NAME}=${createToken(user.id, session.sid, ttlMs)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Cierra la sesión de la petición actual (logout).
function closeCurrentSession(req) {
  const data = readToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  if (data?.sid) closeSession(data.sid);
}

const bannedMessage = () => `Tu cuenta fue suspendida. Escribe a ${SELLER.contact} para aclararlo.`;

// Devuelve { user } si la sesión vale, o { status, body } con el motivo si no.
function resolveSession(req) {
  const generic = { status: 401, body: { error: 'Inicia sesión para continuar.' } };
  const data = readToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  if (!data) return generic;
  // Un usuario bloqueado ve el motivo, aunque sus sesiones ya se hayan cerrado.
  if (findUserById(data.uid)?.status === 'banned') return { status: 401, body: { error: bannedMessage(), code: 'banned' } };
  if (!sessions.some((x) => x.sid === data.sid && x.expiresAt > Date.now())) {
    if (replacedSessions.has(data.sid)) {
      return {
        status: 401,
        body: { error: `Tu sesión se cerró porque iniciaste sesión en otro dispositivo (máximo ${LIMITS.maxSessions} a la vez).`, code: 'session_replaced' },
      };
    }
    return generic;
  }
  const user = findUserById(data.uid);
  if (!user) return generic;
  if (user.status === 'banned') return { status: 401, body: { error: bannedMessage(), code: 'banned' } };
  if (isExpired(user)) return { status: 401, body: { error: expiredMessage(user), code: 'access_expired' } };
  return { user };
}

function requireAuth(req, res, next) {
  const result = resolveSession(req);
  if (!result.user) return res.status(result.status).json(result.body);
  req.user = result.user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede hacer esto.' });
    next();
  });
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
const MAX_FAILS_PER_ACCOUNT = 5; // por cuenta y desde una misma IP
// Por IP en total. Es alto a propósito: si el servidor está detrás de un proxy sin TRUST_PROXY, todos los clientes comparten IP.
const MAX_FAILS_PER_IP = 100;
const failures = new Map();

function recentFailures(key) {
  const now = Date.now();
  const list = (failures.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

// Revisa el límite y, si se puede intentar, anota el intento AL INSTANTE (antes de verificar la contraseña, que tarda).
// Si se anotara después, una ráfaga de peticiones simultáneas pasaría todas el chequeo antes de que se registrara alguna.
// Devuelve { wait } (segundos) si hay que esperar, o { wait: 0, forgive } donde forgive() borra el intento si acertó.
function beginAttempt(ip, username) {
  const keys = [
    [`acct:${ip}:${normalizeUsername(username)}`, MAX_FAILS_PER_ACCOUNT],
    [`ip:${ip}`, MAX_FAILS_PER_IP],
  ];
  for (const [key, max] of keys) {
    const list = recentFailures(key);
    if (list.length >= max) return { wait: Math.ceil((list[0] + WINDOW_MS - Date.now()) / 1000) };
  }
  const at = Date.now();
  for (const [key] of keys) failures.set(key, [...recentFailures(key), at]);
  const forgive = () => {
    for (const [key] of keys) {
      const list = failures.get(key);
      if (!list) continue;
      const i = list.indexOf(at);
      if (i !== -1) list.splice(i, 1);
      if (list.length === 0) failures.delete(key);
    }
  };
  return { wait: 0, forgive };
}

// Tras un acceso correcto también se olvidan los fallos anteriores de esa cuenta desde esa IP.
function clearFailures(ip, username) {
  failures.delete(`acct:${ip}:${normalizeUsername(username)}`);
}

module.exports = {
  USERNAME_REGEX,
  EMAIL_REGEX,
  isValidDate,
  isExpired,
  expiredMessage,
  bannedMessage,
  setExpiry,
  addUser,
  removeUser,
  listUsers,
  findUserById,
  findUserByEmail,
  updateUser,
  setPassword,
  banUser,
  unbanUser,
  uniqueUsername,
  generatePassword,
  authenticate,
  publicUser,
  requireAuth,
  requireAdmin,
  resolveSession,
  sameOriginOnly,
  setSessionCookie,
  clearSessionCookie,
  closeCurrentSession,
  activeSessionCount,
  revokeUserSessions,
  currentSid,
  beginAttempt,
  clearFailures,
  normalizeUsername,
  normalizeEmail,
};
