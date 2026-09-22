// Pruebas del flujo de compra sin Telegram: comprar en el sitio → pagar en Stripe (falso) → el webhook activa la
// cuenta → la pantalla de "pago exitoso" consulta las credenciales → el recibo se puede descargar.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const PASSWORD_RE = /^[A-Za-z0-9]{10,}$/;
let srv;
let stripe;

before(async () => {
  stripe = await h.startFakeStripeApi();
  srv = await h.startServer({}, { stripe });
});
after(() => {
  srv.stop();
  stripe.stop();
});

// Simula la parte que hace el navegador: pedir el checkout, "pagar" en Stripe y recibir el webhook.
async function buy(plan, { email, name } = {}) {
  const api = h.client(srv);
  const { status, json } = await api.post('/api/checkout', { plan, acceptedTerms: true });
  assert.equal(status, 200, JSON.stringify(json));
  const sessionId = new URL(json.url.replace('http://fake-stripe.test/pay/', 'http://x/')).pathname.slice(1);
  assert.ok(stripe.sessions.has(sessionId), 'debe existir la sesión que el backend dice haber creado');

  const before = await api.get(`/api/checkout-status/${sessionId}`);
  assert.equal(before.json.ready, false, 'antes del webhook no debe haber nada que mostrar');

  stripe.markComplete(sessionId, { email, name });
  const webhook = await h.fireStripeWebhook(srv, stripe.sessions.get(sessionId));
  assert.equal(webhook.status, 200);

  return { api, sessionId };
}

test('validaciones: sin aceptar términos, o con un plan que no existe, no se crea nada', async () => {
  const api = h.client(srv);
  const noTerms = await api.post('/api/checkout', { plan: 'basic', acceptedTerms: false });
  assert.equal(noTerms.status, 400);
  const badPlan = await api.post('/api/checkout', { plan: 'oro', acceptedTerms: true });
  assert.equal(badPlan.status, 400);
  assert.equal(srv.run(`console.log(require('./payments').list().length)`), '0');
});

test('sin STRIPE_SECRET_KEY configurada, las compras se desactivan solas', async () => {
  const off = await h.startServer();
  try {
    const { status, json } = await h.client(off).post('/api/checkout', { plan: 'basic', acceptedTerms: true });
    assert.equal(status, 503);
    assert.match(json.error, /no están disponibles/);
  } finally {
    off.stop();
  }
});

test('compra completa: pagar activa la cuenta sola y la pantalla de éxito puede mostrar la contraseña', async () => {
  const { api, sessionId } = await buy('basic', { email: 'maria@example.com', name: 'María López Ruiz' });

  const status = await api.get(`/api/checkout-status/${sessionId}`);
  assert.equal(status.json.ready, true);
  assert.equal(status.json.created, true);
  assert.match(status.json.password, PASSWORD_RE);
  assert.equal(status.json.name, 'María López Ruiz');

  // Con esas credenciales sí se puede entrar.
  const fresh = h.client(srv);
  assert.equal((await fresh.login(status.json.username, status.json.password)).status, 200);

  // El recibo se puede descargar con el mismo session_id (nadie más lo conoce).
  const receipt = await fetch(`${srv.base}/api/receipt/${sessionId}`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.headers.get('content-type'), 'application/pdf');
  assert.ok((await receipt.arrayBuffer()).byteLength > 500, 'debe ser un PDF real, no una respuesta vacía');
});

test('un webhook con firma inválida no activa nada', async () => {
  const fake = { id: 'cs_test_falso', metadata: { reference: 'DUO-9999-999' }, customer_details: { email: 'x@x.com' } };
  const { status } = await h.fireStripeWebhook(srv, fake, { secret: 'whsec_no_es_el_correcto' });
  assert.equal(status, 400);
});

test('un segundo webhook para el mismo pago (Stripe reintenta) no lo duplica ni rompe nada', async () => {
  const { sessionId } = await buy('basic', { email: 'retry@example.com', name: 'Retry Cliente' });
  const retry = await h.fireStripeWebhook(srv, stripe.sessions.get(sessionId));
  assert.equal(retry.status, 200); // sigue respondiendo 200: no hay que reintentar un evento ya procesado
});

test('el mismo correo comprando otra vez renueva la cuenta en vez de crear una segunda (y no hay contraseña nueva)', async () => {
  const first = await buy('basic', { email: 'renueva@example.com', name: 'Renueva Cliente' });
  const firstStatus = await first.api.get(`/api/checkout-status/${first.sessionId}`);
  const username = firstStatus.json.username;

  const second = await buy('lifetime', { email: 'renueva@example.com', name: 'Renueva Cliente' });
  const secondStatus = await second.api.get(`/api/checkout-status/${second.sessionId}`);
  assert.equal(secondStatus.json.created, false);
  assert.equal(secondStatus.json.password, null);
  assert.equal(secondStatus.json.username, username, 'debe ser la misma cuenta, no una nueva');

  const users = JSON.parse(srv.run(`console.log(JSON.stringify(require('./auth').listUsers().filter((u) => u.username === '${username}')))`));
  assert.equal(users.length, 1);
  assert.equal(users[0].plan, 'lifetime');
});

test('generar una nueva contraseña ya logueado no cierra la sesión actual, pero sí las demás', async () => {
  const { api, sessionId } = await buy('basic', { email: 'cambia@example.com', name: 'Cambia Cliente' });
  const { username, password } = (await api.get(`/api/checkout-status/${sessionId}`)).json;

  const device1 = h.client(srv);
  const device2 = h.client(srv);
  await device1.login(username, password);
  await device2.login(username, password);

  const reset = await device1.post('/api/account/reset-password');
  assert.equal(reset.status, 200);
  assert.match(reset.json.password, PASSWORD_RE);
  assert.notEqual(reset.json.password, password);

  assert.equal((await device1.get('/api/auth/me')).status, 200, 'quien pidió el cambio sigue adentro');
  assert.equal((await device2.get('/api/auth/me')).status, 401, 'las otras sesiones se cierran');
  assert.equal((await h.client(srv).login(username, password)).status, 401, 'la contraseña vieja ya no sirve');
  assert.equal((await h.client(srv).login(username, reset.json.password)).status, 200, 'la nueva sí');
});

test('el administrador puede restablecer la contraseña de alguien que perdió su acceso', async () => {
  const { api, sessionId } = await buy('basic', { email: 'perdido@example.com', name: 'Perdido Cliente' });
  const { username } = (await api.get(`/api/checkout-status/${sessionId}`)).json;

  h.addUser(srv, { username: 'admin2', name: 'Admin', password: 'clave-de-prueba-123', role: 'admin', plan: 'lifetime' });
  const admin = h.client(srv);
  await admin.login('admin2', 'clave-de-prueba-123');
  const { json } = await admin.get('/api/admin/summary');
  const target = json.users.find((u) => u.username === username);

  const reset = await admin.post(`/api/admin/users/${target.id}/reset-password`);
  assert.equal(reset.status, 200);
  assert.match(reset.json.password, PASSWORD_RE);
  assert.equal((await h.client(srv).login(username, reset.json.password)).status, 200);
});

test('no se pueden hacer más de 10 checkouts por minuto desde la misma IP', async () => {
  const s = await h.startServer({}, { stripe });
  try {
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await h.client(s).post('/api/checkout', { plan: 'basic', acceptedTerms: true })).status);
    assert.ok(codes.includes(429), `debió aparecer un 429 entre: ${codes.join(' ')}`);
  } finally {
    s.stop();
  }
});
