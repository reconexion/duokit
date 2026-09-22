// Pruebas de regresión de la auditoría de seguridad: cada una reproduce un fallo que se encontró y se corrigió.
// Ejecutar: npm test --prefix backend
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const YEAR = new Date().getFullYear();
const PASSWORD = 'clave-de-prueba-123';
let srv;
let adminApi;

const download = (api, body = {}) =>
  api.post('/api/download', { url: 'https://www.youtube.com/watch?v=abc', downloadVideo: true, videoQuality: '1080p', ...body });

async function loggedIn(username, extra = {}) {
  h.addUser(srv, { username, name: `Cliente ${username}`, password: PASSWORD, expiresAt: '2099-01-01', ...extra });
  const api = h.client(srv);
  assert.equal((await api.login(username, PASSWORD)).status, 200);
  return api;
}

before(async () => {
  srv = await h.startServer({ DUOKIT_STRIKE_GAP_MS: '0' });
  h.addUser(srv, { username: 'admin1', name: 'Admin', password: PASSWORD, role: 'admin', plan: 'lifetime' });
  adminApi = h.client(srv);
  assert.equal((await adminApi.login('admin1', PASSWORD)).status, 200);
});
after(() => srv.stop());

test('confirmar varios pagos a la vez no pierde cuentas', async () => {
  srv.run(`const p = require('./payments'); for (let i = 0; i < 3; i++) p.create({ plan: 'basic' });`);
  const results = await Promise.all([1, 2, 3].map((n) => adminApi.post(`/api/admin/payments/DUO-${YEAR}-00${n}/confirm`)));
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
  const { json } = await adminApi.get('/api/admin/summary');
  const existing = new Set(json.users.map((u) => u.username));
  for (const r of results) assert.ok(existing.has(r.json.username), `${r.json.username} pagó pero su cuenta no existe`);
});

test('confirmar dos veces el mismo pago no lo duplica', async () => {
  const again = await adminApi.post(`/api/admin/payments/DUO-${YEAR}-001/confirm`);
  assert.equal(again.status, 400);
});

test('una ráfaga de logins fallidos no se cuela por encima del límite', async () => {
  h.addUser(srv, { username: 'burst1', name: 'Burst', password: PASSWORD });
  const results = await Promise.all(Array.from({ length: 40 }, () => h.client(srv).login('burst1', 'mala')));
  const count = (status) => results.filter((r) => r.status === status).length;
  assert.ok(count(401) <= 5, `${count(401)} intentos pasaron (el límite es 5)`);
  assert.equal(count(401) + count(429), 40);
  // El bloqueo es por cuenta+IP: otra cuenta desde la misma IP sigue pudiendo entrar.
  assert.equal((await h.client(srv).login('admin1', PASSWORD)).status, 200);
});

test('los accesos correctos no cuentan como intentos fallidos', async () => {
  h.addUser(srv, { username: 'okuser', name: 'Ok', password: PASSWORD });
  for (let i = 0; i < 8; i++) assert.equal((await h.client(srv).login('okuser', PASSWORD)).status, 200);
});

test('la calidad del plan no se salta con claves raras', async () => {
  const api = await loggedIn('basic1');
  assert.equal((await download(api, { videoQuality: '4K' })).status, 403);
  assert.equal((await download(api, { videoQuality: '2K' })).status, 403);
  for (const videoQuality of ['constructor', '__proto__', 'toString', ['4K']]) {
    assert.equal((await download(api, { videoQuality })).status, 400, `videoQuality=${JSON.stringify(videoQuality)}`);
  }
  assert.equal((await download(api, { startTime: ['00:00:01'], endTime: '00:00:05' })).status, 400);
  assert.equal((await download(api, { url: '--exec id https://youtube.com/x' })).status, 400);
});

test('los errores no filtran detalles internos', async () => {
  const badCookie = await h.client(srv).get('/api/auth/me', { cookie: 'duokit_session=%E0%A4%A' });
  assert.equal(badCookie.status, 401);
  const broken = await fetch(`${srv.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":' });
  const text = await broken.text();
  assert.equal(broken.status, 400);
  assert.doesNotMatch(text, /node_modules|\bat \w|SyntaxError/);
  const missing = await h.client(srv).get('/api/nada');
  assert.equal(missing.status, 404);
  assert.ok(missing.json?.error);
});

test('al cliente le llegan mensajes claros, sin rutas ni texto técnico de yt-dlp', async () => {
  const api = await loggedIn('msg1');
  const cases = [
    ['filtered', /transmisión en vivo/],
    ['toolarge', /pesa más/],
    ['blocked', /YouTube bloqueó/],
  ];
  for (const [mode, expected] of cases) {
    srv.setMode(mode);
    const { json } = await download(api);
    const job = await h.waitJob(api, json.jobId);
    assert.equal(job.status, 'error', mode);
    assert.match(job.error, expected, mode);
    assert.doesNotMatch(job.error, /\/home|\.cache|--cookies/, mode);
  }
  srv.setMode('ok');
  const { json } = await download(api);
  const done = await h.waitJob(api, json.jobId);
  assert.equal(done.status, 'done');
  assert.equal(done.files.length, 1);
});

test('máximo de descargas en curso por usuario (sin castigarlo con un choque)', async () => {
  srv.setMode('slow3');
  const api = await loggedIn('busy1');
  assert.equal((await download(api)).status, 200);
  assert.equal((await download(api)).status, 200);
  const third = await download(api);
  assert.equal(third.status, 429);
  assert.equal(third.json.code, 'busy');
  srv.setMode('ok');
});

test('al desbloquear a un usuario se borran sus choques y no vuelve a bloquearse al primero', async () => {
  const api = await loggedIn('strike1');
  for (let i = 0; i < 5; i++) {
    const { status, json } = await download(api);
    assert.equal(status, 200);
    await h.waitJob(api, json.jobId);
  }
  let banned = false;
  for (let i = 0; i < 6 && !banned; i++) banned = (await download(api)).json.code === 'banned';
  assert.ok(banned, 'debió bloquearse tras 5 choques');

  const { json } = await adminApi.get('/api/admin/summary');
  const target = json.users.find((u) => u.username === 'strike1');
  assert.equal(target.status, 'banned');
  assert.equal((await adminApi.post(`/api/admin/users/${target.id}/unban`)).status, 200);

  const again = h.client(srv);
  assert.equal((await again.login('strike1', PASSWORD)).status, 200);
  const first = await download(again); // sigue en el tope por minuto: es un choque, pero solo el primero
  assert.equal(first.status, 429);
  assert.equal(first.json.code, 'rate_limit');
});

test('una descarga que se cuelga se cancela y se mata su proceso', async () => {
  const s = await h.startServer({ DUOKIT_JOB_TIMEOUT_MS: '1500' });
  try {
    h.addUser(s, { username: 'slow1', name: 'Lento', password: PASSWORD });
    s.setMode('slow');
    const api = h.client(s);
    await api.login('slow1', PASSWORD);
    const { json } = await download(api);
    const job = await h.waitJob(api, json.jobId, 10000);
    assert.equal(job.status, 'error');
    assert.match(job.error, /tardó demasiado/);
    await h.sleep(300);
    assert.throws(() => process.kill(s.lastPid(), 0), 'el proceso de yt-dlp debió morir');
  } finally {
    s.stop();
  }
});

test('un administrador no puede bloquearse a sí mismo y un cliente no entra al panel', async () => {
  const api = await loggedIn('plain1');
  assert.equal((await api.get('/api/admin/summary')).status, 403);
  assert.equal((await api.post(`/api/admin/payments/DUO-${YEAR}-001/confirm`)).status, 403);
  const { json } = await adminApi.get('/api/admin/summary');
  const admin = json.users.find((u) => u.username === 'admin1');
  assert.equal((await adminApi.post(`/api/admin/users/${admin.id}/ban`)).status, 400);
});
