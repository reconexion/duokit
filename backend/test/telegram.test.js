// Pruebas del bot de Telegram contra un Telegram falso: flujo de venta y permisos del administrador.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const YEAR = new Date().getFullYear();
const REF = `DUO-${YEAR}-001`;
let srv;
let tg;
let admin;
let customer;
let impostor;

const paymentStatus = () => srv.run(`console.log(require('./payments').get('${REF}').status)`);
const said = (replies, to) => replies.filter((r) => r.to === to).map((r) => r.text).join('\n');

before(async () => {
  tg = await h.startFakeTelegram();
  srv = await h.startServer({ TELEGRAM_BOT_TOKEN: 'testtoken', TELEGRAM_API_URL: tg.url, ADMIN_TELEGRAM: 'tostilocos' });
  admin = tg.from(1, 'Tostilocos');
  customer = tg.from(500, 'maria_c');
  impostor = tg.from(2, 'tostilocos'); // mismo @usuario, otro ID: alguien que se quedó con el @usuario después
  await h.sleep(500);
});
after(() => {
  srv.stop();
  tg.stop();
});

test('venta completa y solo el administrador (fijado por ID) puede confirmar, con el monto correcto', async () => {
  tg.say(admin, '/start');
  await tg.replies();

  tg.say(customer, '/comprar');
  tg.tap(customer, 'buy:basic');
  tg.say(customer, 'María López Ruiz');
  const purchase = await tg.replies(1200);
  assert.match(said(purchase, 500), new RegExp(REF));
  assert.match(said(purchase, 500), /no hay reembolsos/i, 'el cliente debe ver que no hay reembolsos antes de pagar');
  assert.match(said(purchase, 1), /Pago pendiente/);

  // Alguien con el mismo @usuario pero otro ID no es el administrador.
  tg.say(impostor, `/confirmar ${REF} 129`);
  assert.match(said(await tg.replies(), 2), /No entendí/);
  assert.equal(paymentStatus(), 'pending');

  // Sin monto no se activa nada.
  tg.say(admin, `/confirmar ${REF}`);
  assert.match(said(await tg.replies(), 1), /monto/i);
  assert.equal(paymentStatus(), 'pending');

  // Con un monto que no coincide con el plan (por ejemplo el del Permanente), tampoco.
  tg.say(admin, `/confirmar ${REF} 2999`);
  assert.match(said(await tg.replies(), 1), /no coincide/);
  assert.equal(paymentStatus(), 'pending');

  // Con el monto correcto sí, y al cliente le llegan sus datos.
  tg.say(admin, `/confirmar ${REF} $129.00`);
  const confirmed = await tg.replies(1200);
  assert.match(said(confirmed, 1), /confirmado/);
  const message = said(confirmed, 500);
  assert.match(message, /Pago confirmado/);
  assert.equal(paymentStatus(), 'paid');

  // Recuperar la contraseña cierra las sesiones abiertas con la anterior.
  const [, username] = /Usuario: (\S+)/.exec(message);
  const [, password] = /Contraseña: (\S+)/.exec(message);
  const api = h.client(srv);
  assert.equal((await api.login(username, password)).status, 200);
  assert.equal((await api.get('/api/auth/me')).status, 200);
  tg.say(customer, '/recuperar');
  const reset = said(await tg.replies(), 500);
  assert.match(reset, /Contraseña: /);
  assert.equal((await api.get('/api/auth/me')).status, 401, 'la sesión abierta debió cerrarse');
});

test('otro cliente no puede tocar el pago de alguien más', async () => {
  const other = tg.from(700, 'otro');
  tg.say(customer, '/comprar');
  tg.tap(customer, 'buy:lifetime');
  const created = said(await tg.replies(1200), 500);
  const ref = /DUO-\d{4}-\d{3}/.exec(created)[0];
  tg.tap(other, `paid:${ref}`);
  tg.tap(other, `cancel:${ref}`);
  assert.match(said(await tg.replies(), 700), /No encontré/);
  assert.equal(srv.run(`console.log(require('./payments').get('${ref}').status)`), 'pending');
});

test('si varias descargas seguidas fallan por YouTube/yt-dlp, el administrador recibe un aviso (y otro al recuperarse)', async () => {
  h.addUser(srv, { username: 'health1', name: 'Salud', password: 'clave-de-prueba-123', plan: 'lifetime' });
  const api = h.client(srv);
  await api.login('health1', 'clave-de-prueba-123');
  await tg.replies(0); // descarta lo anterior

  srv.setMode('blocked');
  for (let i = 0; i < 3; i++) {
    const { json } = await api.post('/api/download', { url: 'https://www.youtube.com/watch?v=abc', downloadVideo: true, videoQuality: '480p' });
    assert.equal((await h.waitJob(api, json.jobId)).status, 'error');
  }
  const alert = said(await tg.replies(), 1);
  assert.match(alert, /3 descargas seguidas fallaron/);
  assert.match(alert, /pipx upgrade yt-dlp/);

  srv.setMode('ok');
  const { json } = await api.post('/api/download', { url: 'https://www.youtube.com/watch?v=abc', downloadVideo: true, videoQuality: '480p' });
  assert.equal((await h.waitJob(api, json.jobId)).status, 'done');
  assert.match(said(await tg.replies(), 1), /vuelven a funcionar/);
});
