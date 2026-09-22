// Utilidades para las pruebas: levantan el backend real en un puerto libre, con datos temporales,
// un yt-dlp falso (sin red) y, si se pide, un Telegram falso. Nada toca backend/data ni el bot real.
const { spawn, execFileSync } = require('node:child_process');
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

async function startServer(extraEnv = {}, { dist } = {}) {
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
    TELEGRAM_BOT_TOKEN: '', // vacío y ya definido: .env no lo pisa
    SELLER_ACCOUNT: '012345678901234567',
    ADMIN_TELEGRAM_ID: '',
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_DIR: root,
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

// Telegram falso: guarda lo que el bot envía y sirve los mensajes que la prueba "escribe".
async function startFakeTelegram() {
  const queue = [];
  const sent = [];
  const menus = []; // menús de comandos publicados: { scope: chat_id | null, commands: [...] }
  let updateId = 100;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const reply = (result) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result }));
    };
    const method = req.url.split('/').pop();
    if (method === 'getMe') return reply({ username: 'fake_bot' });
    if (method === 'getUpdates') {
      const { offset } = JSON.parse(raw);
      const pending = queue.filter((u) => u.update_id >= offset);
      return pending.length ? reply(pending) : setTimeout(() => reply([]), 200);
    }
    if (method === 'setMyCommands') {
      const p = JSON.parse(raw);
      menus.push({ scope: p.scope?.chat_id ?? null, commands: p.commands.map((c) => c.command) });
    }
    if (method === 'sendMessage') {
      const p = JSON.parse(raw);
      sent.push({ to: Number(p.chat_id), text: p.text });
    } else if (method === 'sendDocument') {
      sent.push({ to: Number(/name="chat_id"\r\n\r\n(\d+)/.exec(raw.toString('latin1'))?.[1]), text: '[PDF]' });
    }
    return reply({});
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const from = (id, username) => ({ id, username, first_name: username || 'Cliente', is_bot: false });
  return {
    url: `http://localhost:${server.address().port}`,
    menus,
    from,
    say: (user, text) => queue.push({ update_id: ++updateId, message: { chat: { id: user.id, type: 'private' }, from: user, text } }),
    tap: (user, data) =>
      queue.push({ update_id: ++updateId, callback_query: { id: `q${updateId}`, from: user, data, message: { chat: { id: user.id, type: 'private' } } } }),
    // Espera a que el bot conteste algo (nada más se recibe durante `settleMs`) y devuelve lo enviado desde la última vez.
    async replies(settleMs = 700) {
      await sleep(settleMs);
      return sent.splice(0);
    },
    stop: () => server.close(),
  };
}

module.exports = { startServer, addUser, client, sleep, waitJob, startFakeTelegram };
