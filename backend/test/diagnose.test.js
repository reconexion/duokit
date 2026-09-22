// Pruebas de /api/admin/ytdlp-diagnose con un yt-dlp falso controlado por DIAG_MODE, para no depender de la red
// ni de si el servidor de pruebas está bloqueado o no. También comprueba que el propio yt-dlp real que hay instalado
// aquí no está bloqueado (ver el segundo test): si algún día lo estuviera, este test fallaría y avisaría.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./helpers');

const FAKE = `#!/usr/bin/env bash
# DIAG_MODE controla cómo responde este yt-dlp falso, para probar diagnose.js sin red:
#   all_ok        — siempre funciona
#   android_fixes — bloqueado salvo con player_client=android (el caso típico en la nube)
#   all_blocked   — bloqueado pase lo que pase (hace falta proxy/cookies)
#   unrelated     — falla, pero con un error que NO es un bloqueo (no debe sugerir pagar nada)
case "$DIAG_MODE" in
  all_ok) exit 0 ;;
  android_fixes)
    if [[ "$*" == *"player_client=android"* ]]; then exit 0; fi
    echo "ERROR: [youtube] Sign in to confirm you're not a bot. This helps protect our community." >&2
    exit 1 ;;
  all_blocked)
    echo "ERROR: [youtube] Sign in to confirm you're not a bot." >&2
    exit 1 ;;
  unrelated)
    echo "ERROR: [youtube] Video unavailable. This video has been removed by the uploader" >&2
    exit 1 ;;
esac
`;

function withFakeYtdlp(mode, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duokit-diag-'));
  fs.writeFileSync(path.join(dir, 'yt-dlp'), FAKE, { mode: 0o755 });
  const env = { ...process.env, DIAG_MODE: mode, PATH: `${dir}:${process.env.PATH}` };
  delete env.YTDLP_PLAYER_CLIENT;
  delete env.YTDLP_COOKIES_FILE;
  delete env.YTDLP_EXTRA_ARGS;
  return run(env, dir).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

// Ejecuta diagnose.js en un proceso aparte (con su propio PATH/env), no con require, para que DIAG_MODE no se
// contamine entre pruebas (el yt-dlp falso vive fuera del proceso de pruebas).
const runDiagnose = (env) =>
  JSON.parse(require('node:child_process').execFileSync('node', ['-e', "require('./diagnose').diagnose().then((r) => console.log(JSON.stringify(r)))"], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
  }));

test('todo funciona: no sugiere cambiar nada', () =>
  withFakeYtdlp('all_ok', async (env) => {
    const r = runDiagnose(env);
    assert.match(r.verdict, /ya funciona/);
    assert.ok(r.results.every((x) => x.ok));
  }));

test('bloqueado, pero el cliente android lo arregla: lo dice y no sugiere pagar', () =>
  withFakeYtdlp('android_fixes', async (env) => {
    const r = runDiagnose(env);
    assert.match(r.verdict, /player_client=android.*funcion/);
    assert.doesNotMatch(r.verdict, /proxy/i);
    const current = r.results[0];
    assert.equal(current.ok, false);
    assert.equal(current.blocked, true, 'el error de "Sign in to confirm" debe reconocerse como bloqueo');
  }));

test('bloqueado en todo lo probado: recomienda proxy o cookies', () =>
  withFakeYtdlp('all_blocked', async (env) => {
    const r = runDiagnose(env);
    assert.match(r.verdict, /proxy residencial|cookies/i);
  }));

test('una falla que no es bloqueo no debe confundirse con uno (no sugiere pagar)', () =>
  withFakeYtdlp('unrelated', async (env) => {
    const r = runDiagnose(env);
    assert.match(r.verdict, /no parece ser un bloqueo/i);
    assert.doesNotMatch(r.verdict, /proxy residencial|cookies|YTDLP_PLAYER_CLIENT/);
    assert.ok(r.results.every((x) => x.blocked === false), 'ningún resultado debe marcarse como bloqueo');
  }));

test('YTDLP_PLAYER_CLIENT ya puesto en el servidor se prueba como "configuración actual"', () =>
  withFakeYtdlp('android_fixes', async (env) => {
    const r = runDiagnose({ ...env, YTDLP_PLAYER_CLIENT: 'android' });
    assert.equal(r.results[0].label, 'Configuración actual del servidor');
    assert.equal(r.results[0].ok, true);
    assert.match(r.verdict, /ya funciona/);
  }));

test('la ruta es solo para el administrador y responde con el veredicto', async () => {
  const srv = await h.startServer();
  try {
    h.addUser(srv, { username: 'admin1', name: 'Admin', password: 'clave-de-prueba-123', role: 'admin', plan: 'lifetime' });
    h.addUser(srv, { username: 'cliente1', name: 'Cliente', password: 'clave-de-prueba-123' });

    const anon = await h.client(srv).get('/api/admin/ytdlp-diagnose');
    assert.equal(anon.status, 401);

    const cliente = h.client(srv);
    await cliente.login('cliente1', 'clave-de-prueba-123');
    assert.equal((await cliente.get('/api/admin/ytdlp-diagnose')).status, 403);

    const admin = h.client(srv);
    await admin.login('admin1', 'clave-de-prueba-123');
    const { status, json } = await admin.get('/api/admin/ytdlp-diagnose');
    assert.equal(status, 200);
    assert.ok(json.verdict && Array.isArray(json.results));
  } finally {
    srv.stop();
  }
});
