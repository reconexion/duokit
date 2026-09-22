// Utilidades para las pruebas: levantan el backend real en un puerto libre, con datos temporales,
// un yt-dlp falso (sin red) y, si se pide, un Mercado Pago falso. Nada toca backend/data.
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const BACKEND = path.join(__dirname, '..');

// El modo lo lee de FAKE_DIR/mode en cada ejecución, así una prueba puede cambiarlo sin reiniciar el servidor.
const FAKE_YTDLP = `#!/usr/bin/env bash
mode=$(cat "$FAKE_DIR/mode" 2>/dev/null || echo ok)
dir=""; prev=""
for a in "$@"; do [ "$prev" = "-P" ] && dir="$a"; prev="$a"; done
echo $$ > "$FAKE_DIR/last.pid"
case "$mode" in
  filtered) echo "[download] Video does not pass filter (!is_live), skipping .."; exit 0 ;;
  toolarge) echo "[download] File is larger than max-filesize (2000000000 bytes > 1 bytes), skipping download."; exit 0 ;;
  blocked) echo "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies (/home/dueno/.cache/x)" >&2; exit 1 ;;
  slow) sleep 30 ;;
  slow3) sleep 3 ;;
esac
echo "[download] 100% of 1MiB"
echo data > "$dir/video.mp4"
`;

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer().listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

async function startServer(extraEnv = {}, { dist, mercadopago } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'duokit-test-'));
  if (dist) {
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'index.html'), dist.indexHtml ?? '<!doctype html><title>test</title>');
    if (dist.files) for (const [name, content] of Object.entries(dist.files)) fs.writeFileSync(path.join(root, 'dist', name), content);
  }
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'yt-dlp'), FAKE_YTDLP, { mode: 0o755 });
  const port = await freePort();
  const env = {
    ...process.env,
    DATA_DIR: path.join(root, 'data'),
    DUOKIT_TMP_DIR: path.join(root, 'jobs'),
    PORT: String(port),
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_DIR: root,
    // Por defecto SIEMPRE se anulan: config.js carga backend/.env con process.loadEnvFile, que solo rellena
    // variables que el proceso no traiga ya puestas — así que sin esto, cualquier prueba heredaría sin querer las
    // credenciales REALES de backend/.env (si alguien ya las configuró ahí) y llamaría a la API de verdad. Si la
    // prueba pasa un Mercado Pago falso (startFakeMercadoPagoApi), se usan credenciales de prueba en su lugar.
    MERCADOPAGO_ACCESS_TOKEN: '',
    MERCADOPAGO_WEBHOOK_SECRET: '',
    ...(mercadopago
      ? {
          MERCADOPAGO_ACCESS_TOKEN: 'TEST-fake',
          MERCADOPAGO_WEBHOOK_SECRET: MERCADOPAGO_TEST_WEBHOOK_SECRET,
          MERCADOPAGO_API_BASE_URL: `${mercadopago.protocol}://${mercadopago.host}:${mercadopago.port}`,
        }
      : {}),
    ...extraEnv,
  };
  const child = spawn('node', ['server.js'], { cwd: BACKEND, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`El servidor no arrancó:\n${log}`)), 15000);
    const check = setInterval(() => {
      if (/escuchando/.test(log)) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 50);
    child.on('exit', () => reject(new Error(`El servidor se cerró:\n${log}`)));
  });
  const server = {
    port,
    root,
    env,
    base: `http://localhost:${port}`,
    logs: () => log,
    setMode: (mode) => fs.writeFileSync(path.join(root, 'mode'), mode),
    lastPid: () => Number(fs.readFileSync(path.join(root, 'last.pid'), 'utf8')),
    stop: () => {
      child.kill();
      fs.rmSync(root, { recursive: true, force: true });
    },
    // Ejecuta código Node con acceso a los módulos del backend y los datos de ESTE servidor (crear usuarios, pagos...).
    run: (code) => execFileSync('node', ['-e', code], { cwd: BACKEND, env, encoding: 'utf8' }).trim(),
  };
  return server;
}

const addUser = (server, fields) =>
  server.run(`require('./auth').addUser(${JSON.stringify(fields)}).then((u) => console.log(u.id))`);

// Cliente HTTP con su propia cookie (un "navegador").
function client(server) {
  let cookie = '';
  const request = async (method, url, body, headers = {}) => {
    const res = await fetch(server.base + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* no era JSON */
    }
    return { status: res.status, json, text };
  };
  return {
    get: (url, headers) => request('GET', url, undefined, headers),
    post: (url, body = {}, headers) => request('POST', url, body, headers),
    login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Espera a que un trabajo de descarga termine (o falle) y devuelve su estado.
async function waitJob(api, jobId, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const { json } = await api.get(`/api/status/${jobId}`);
    if (json && json.status !== 'running') return json;
    if (Date.now() > end) throw new Error('La descarga no terminó a tiempo.');
    await sleep(100);
  }
}

const MERCADOPAGO_TEST_WEBHOOK_SECRET = 'test_secret_de_prueba';

// Mercado Pago falso: solo atiende lo que NUESTRO backend le pide a su API (crear una preferencia, consultar un
// pago). El webhook que Mercado Pago manda DE VUELTA (cuando alguien paga) es una entrega aparte, no pasa por
// aquí: se simula con fireMercadoPagoWebhook, firmado en local con el mismo secreto, tal como lo verifica
// server.js de verdad (con el validador oficial del SDK, mercadopago-checkout.js).
async function startFakeMercadoPagoApi() {
  const preferences = new Map();
  const payments = new Map();
  let n = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://fake-mercadopago.test');
    if (req.method === 'POST' && url.pathname === '/checkout/preferences') {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const id = `pref_test_${++n}`;
      const preference = {
        id,
        init_point: `http://fake-mercadopago.test/pay/${id}`,
        external_reference: body.external_reference ?? null,
        items: body.items ?? [],
        back_urls: body.back_urls ?? {},
      };
      preferences.set(id, preference);
      return send(201, preference);
    }
    const match = req.method === 'GET' && /^\/v1\/payments\/([^/?]+)/.exec(url.pathname);
    if (match) {
      const payment = payments.get(match[1]);
      if (!payment) return send(404, { message: 'Payment not found' });
      return send(200, payment);
    }
    send(404, { message: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return {
    host: 'localhost',
    port,
    protocol: 'http',
    preferences,
    payments,
    // Como si el cliente ya hubiera pagado en Mercado Pago (antes de que llegue el webhook que de verdad activa la
    // cuenta). email/first_name/last_name son lo que Mercado Pago recoge en su checkout hospedado. Devuelve el id
    // del pago (lo que trae la notificación real: data.id), no el de la preferencia.
    approve: (preferenceId, { email = 'cliente@example.com', firstName = 'Cliente', lastName = 'De Prueba' } = {}) => {
      const preference = preferences.get(preferenceId);
      const paymentId = `pay_test_${++n}`;
      payments.set(paymentId, {
        id: paymentId,
        status: 'approved',
        status_detail: 'accredited',
        external_reference: preference.external_reference,
        transaction_amount: preference.items?.[0]?.unit_price ?? null,
        payer: { email, first_name: firstName, last_name: lastName },
      });
      return paymentId;
    },
    stop: () => server.close(),
  };
}

// Firma y manda una notificación de pago directo al backend bajo prueba, con el mismo formato de manifest y HMAC-
// SHA256 que WebhookSignatureValidator (del SDK oficial) verifica de verdad en server.js — ver el propio código del
// validador (node_modules/mercadopago/dist/utils/webhook) para el detalle exacto del manifest.
// `secret` debe coincidir con MERCADOPAGO_WEBHOOK_SECRET del servidor, o la firma sale inválida a propósito.
async function fireMercadoPagoWebhook(server, paymentId, { secret = MERCADOPAGO_TEST_WEBHOOK_SECRET, type = 'payment' } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const requestId = crypto.randomUUID();
  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const hash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const body = JSON.stringify({ action: 'payment.updated', type, data: { id: String(paymentId) } });
  const res = await fetch(`${server.base}/api/webhook/mercadopago?data.id=${encodeURIComponent(paymentId)}&type=${type}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': `ts=${ts},v1=${hash}`,
      'x-request-id': requestId,
    },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* no era JSON */
  }
  return { status: res.status, json, text };
}

module.exports = {
  startServer,
  addUser,
  client,
  sleep,
  waitJob,
  startFakeMercadoPagoApi,
  fireMercadoPagoWebhook,
  MERCADOPAGO_TEST_WEBHOOK_SECRET,
};
