// Utilidades para las pruebas: levantan el backend real en un puerto libre, con datos temporales,
// un yt-dlp falso (sin red) y, si se pide, un Stripe falso. Nada toca backend/data.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const qs = require('qs');
const Stripe = require('stripe');

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

async function startServer(extraEnv = {}, { dist, stripe } = {}) {
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
    // Si la prueba pasa un Stripe falso (startFakeStripeApi), el backend le habla a él en vez de a la API real.
    ...(stripe
      ? {
          STRIPE_SECRET_KEY: 'sk_test_fake',
          STRIPE_WEBHOOK_SECRET: STRIPE_TEST_WEBHOOK_SECRET,
          STRIPE_API_HOST: stripe.host,
          STRIPE_API_PORT: String(stripe.port),
          STRIPE_API_PROTOCOL: stripe.protocol,
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

const STRIPE_TEST_WEBHOOK_SECRET = 'whsec_test_secret';

// Stripe falso: solo atiende lo que NUESTRO backend le pide a la API de Stripe (crear y consultar una sesión de
// Checkout). El webhook que Stripe manda DE VUELTA (cuando alguien paga) es una entrega aparte, no pasa por aquí:
// se simula con fireStripeWebhook, firmado en local con el mismo secreto, tal como lo verifica server.js de verdad.
async function startFakeStripeApi() {
  const sessions = new Map();
  let n = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const body = qs.parse(Buffer.concat(chunks).toString());
      const id = `cs_test_${++n}`;
      const session = {
        id,
        object: 'checkout.session',
        url: `http://fake-stripe.test/pay/${id}`,
        status: 'open',
        payment_status: 'unpaid',
        client_reference_id: body.client_reference_id ?? null,
        metadata: body.metadata ?? {},
        amount_total: Number(body.line_items?.[0]?.price_data?.unit_amount ?? 0),
        currency: body.line_items?.[0]?.price_data?.currency ?? 'mxn',
      };
      sessions.set(id, session);
      return send(200, session);
    }
    const match = req.method === 'GET' && /^\/v1\/checkout\/sessions\/([^/?]+)/.exec(req.url);
    if (match) {
      const session = sessions.get(match[1]);
      if (!session) return send(404, { error: { message: 'No such checkout session', type: 'invalid_request_error' } });
      return send(200, session);
    }
    send(404, { error: { message: 'not found', type: 'invalid_request_error' } });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return {
    host: 'localhost',
    port,
    protocol: 'http',
    sessions,
    // Como si el cliente ya hubiera pagado en Stripe (antes de que llegue el webhook que de verdad activa la cuenta).
    // email/name son lo que Stripe recoge al cobrar (billing_address_collection): así llegan en customer_details.
    markComplete: (id, { email = 'cliente@example.com', name = 'Cliente de Prueba' } = {}) =>
      Object.assign(sessions.get(id), { status: 'complete', payment_status: 'paid', customer_details: { email, name } }),
    stop: () => server.close(),
  };
}

// Firma y manda un webhook checkout.session.completed directo al backend bajo prueba, exactamente como lo verifica
// server.js (Stripe.webhooks.generateTestHeaderString firma en local, sin red, con el mismo algoritmo que Stripe usa
// de verdad). `secret` debe coincidir con STRIPE_WEBHOOK_SECRET del servidor, o la firma sale inválida a propósito.
async function fireStripeWebhook(server, session, { secret = STRIPE_TEST_WEBHOOK_SECRET, type = 'checkout.session.completed' } = {}) {
  const payload = JSON.stringify({
    id: `evt_test_${Math.random().toString(36).slice(2)}`,
    object: 'event',
    type,
    data: { object: session },
  });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const res = await fetch(`${server.base}/api/webhook/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: payload,
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

module.exports = { startServer, addUser, client, sleep, waitJob, startFakeStripeApi, fireStripeWebhook, STRIPE_TEST_WEBHOOK_SECRET };
