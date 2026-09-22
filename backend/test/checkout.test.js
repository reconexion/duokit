// Pruebas del flujo de compra sin Telegram: comprar en el sitio → pagar en Mercado Pago (falso) → el webhook
// activa la cuenta → la pantalla de "pago exitoso" consulta las credenciales → el recibo se puede descargar.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const PASSWORD_RE = /^[A-Za-z0-9]{10,}$/;
let srv;
let mercadopago;

before(async () => {
  mercadopago = await h.startFakeMercadoPagoApi();
  srv = await h.startServer({}, { mercadopago });
});
after(() => {
  srv.stop();
  mercadopago.stop();
});

// Simula la parte que hace el navegador: pedir el checkout, "pagar" en Mercado Pago y recibir el webhook.
// El checkoutToken se saca de back_urls.success, exactamente como lo haría PaymentReturn.jsx al leer la URL de
// vuelta (?checkout=...) — no es un atajo de la prueba, es lo mismo que ve el navegador real.
async function buy(plan, { email, name, surname } = {}) {
  const api = h.client(srv);
  const { status, json } = await api.post('/api/checkout', { plan, acceptedTerms: true });
  assert.equal(status, 200, JSON.stringify(json));
  const preferenceId = new URL(json.url).pathname.split('/').pop();
  assert.ok(mercadopago.preferences.has(preferenceId), 'debe existir la preferencia que el backend dice haber creado');
  const preference = mercadopago.preferences.get(preferenceId);
  const checkoutToken = new URL(preference.back_urls.success).searchParams.get('checkout');
  assert.ok(checkoutToken, 'la URL de vuelta debe traer el checkoutToken');

  const before = await api.get(`/api/checkout-status/${checkoutToken}`);
  assert.equal(before.json.ready, false, 'antes del webhook no debe haber nada que mostrar');

  const paymentId = mercadopago.approve(preferenceId, { email, firstName: name, lastName: surname });
  const webhook = await h.fireMercadoPagoWebhook(srv, paymentId);
  assert.equal(webhook.status, 200);

  return { api, checkoutToken };
}

test('validaciones: sin aceptar términos, o con un plan que no existe, no se crea nada', async () => {
  const api = h.client(srv);
  const noTerms = await api.post('/api/checkout', { plan: 'basic', acceptedTerms: false });
  assert.equal(noTerms.status, 400);
  const badPlan = await api.post('/api/checkout', { plan: 'oro', acceptedTerms: true });
  assert.equal(badPlan.status, 400);
  assert.equal(srv.run(`console.log(require('./payments').list().length)`), '0');
});

test('sin MERCADOPAGO_ACCESS_TOKEN configurada, las compras se desactivan solas', async () => {
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
  const { api, checkoutToken } = await buy('basic', { email: 'maria@example.com', name: 'María', surname: 'López Ruiz' });

  const status = await api.get(`/api/checkout-status/${checkoutToken}`);
  assert.equal(status.json.ready, true);
  assert.equal(status.json.created, true);
  assert.match(status.json.password, PASSWORD_RE);
  assert.equal(status.json.name, 'María López Ruiz');

  // Con esas credenciales sí se puede entrar.
  const fresh = h.client(srv);
  assert.equal((await fresh.login(status.json.username, status.json.password)).status, 200);

  // El recibo se puede descargar con el mismo checkoutToken (nadie más lo conoce).
  const receipt = await fetch(`${srv.base}/api/receipt/${checkoutToken}`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.headers.get('content-type'), 'application/pdf');
  assert.ok((await receipt.arrayBuffer()).byteLength > 500, 'debe ser un PDF real, no una respuesta vacía');
});

test('un webhook con firma inválida no activa nada', async () => {
  const { status } = await h.fireMercadoPagoWebhook(srv, 'pay_test_falso', { secret: 'no_es_el_secreto_correcto' });
  assert.equal(status, 400);
});

test('un segundo webhook para el mismo pago (Mercado Pago reintenta) no lo duplica ni rompe nada', async () => {
  const api = h.client(srv);
  const { status: checkoutStatus, json } = await api.post('/api/checkout', { plan: 'basic', acceptedTerms: true });
  assert.equal(checkoutStatus, 200, JSON.stringify(json));
  const preferenceId = new URL(json.url).pathname.split('/').pop();
  const paymentId = mercadopago.approve(preferenceId, { email: 'retry@example.com', firstName: 'Retry', lastName: 'Cliente' });

  const first = await h.fireMercadoPagoWebhook(srv, paymentId);
  assert.equal(first.status, 200);
  const retry = await h.fireMercadoPagoWebhook(srv, paymentId);
  assert.equal(retry.status, 200); // sigue respondiendo 200: no hay que reintentar un evento ya procesado
});

test('el mismo correo comprando otra vez renueva la cuenta en vez de crear una segunda (y no hay contraseña nueva)', async () => {
  const first = await buy('basic', { email: 'renueva@example.com', name: 'Renueva', surname: 'Cliente' });
  const firstStatus = await first.api.get(`/api/checkout-status/${first.checkoutToken}`);
  const username = firstStatus.json.username;

  const second = await buy('lifetime', { email: 'renueva@example.com', name: 'Renueva', surname: 'Cliente' });
  const secondStatus = await second.api.get(`/api/checkout-status/${second.checkoutToken}`);
  assert.equal(secondStatus.json.created, false);
  assert.equal(secondStatus.json.password, null);
  assert.equal(secondStatus.json.username, username, 'debe ser la misma cuenta, no una nueva');

  const users = JSON.parse(srv.run(`console.log(JSON.stringify(require('./auth').listUsers().filter((u) => u.username === '${username}')))`));
  assert.equal(users.length, 1);
  assert.equal(users[0].plan, 'lifetime');
});

test('generar una nueva contraseña ya logueado no cierra la sesión actual, pero sí las demás', async () => {
  const { api, checkoutToken } = await buy('basic', { email: 'cambia@example.com', name: 'Cambia', surname: 'Cliente' });
  const { username, password } = (await api.get(`/api/checkout-status/${checkoutToken}`)).json;

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
  const { api, checkoutToken } = await buy('basic', { email: 'perdido@example.com', name: 'Perdido', surname: 'Cliente' });
  const { username } = (await api.get(`/api/checkout-status/${checkoutToken}`)).json;

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
  const s = await h.startServer({}, { mercadopago });
  try {
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await h.client(s).post('/api/checkout', { plan: 'basic', acceptedTerms: true })).status);
    assert.ok(codes.includes(429), `debió aparecer un 429 entre: ${codes.join(' ')}`);
  } finally {
    s.stop();
  }
});
