// Pruebas de operación: hora de México, backend solo en localhost y limpieza del registro de actividad.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./helpers');

const BACKEND = path.join(__dirname, '..');
const DAY = 86400000;

test('sin TZ definida, el negocio cuenta el día en hora de México', () => {
  const env = { ...process.env };
  delete env.TZ;
  const offset = execFileSync('node', ['-e', "require('./config'); console.log(new Date().getTimezoneOffset())"], { cwd: BACKEND, env, encoding: 'utf8' });
  assert.equal(Number(offset), 360, 'México (sin horario de verano) va 6 h detrás de UTC');
  // Si el servidor define TZ a propósito, se respeta.
  const utc = execFileSync('node', ['-e', "require('./config'); console.log(new Date().getTimezoneOffset())"], { cwd: BACKEND, env: { ...env, TZ: 'UTC' }, encoding: 'utf8' });
  assert.equal(Number(utc), 0);
});

test('el backend solo escucha en localhost, no en la red', async (t) => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal);
  if (!lan) return t.skip('este equipo no tiene una IP de red para probar');
  const srv = await h.startServer();
  try {
    assert.equal((await fetch(`${srv.base}/api/auth/me`)).status, 401, 'por localhost responde');
    await assert.rejects(fetch(`http://${lan.address}:${srv.port}/api/auth/me`), 'por la IP de la red no debe responder');
  } finally {
    srv.stop();
  }
});

test('el registro de actividad borra lo viejo y conserva el total de descargas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duokit-audit-'));
  try {
    const at = (daysAgo) => Date.now() - daysAgo * DAY;
    const lines = [
      { ts: at(200), type: 'download_start', userId: 'a', url: 'https://youtube.com/viejo1', ip: '1.1.1.1' },
      { ts: at(120), type: 'download_start', userId: 'a', url: 'https://youtube.com/viejo2', ip: '1.1.1.1' },
      { ts: at(100), type: 'login', userId: 'a', ip: '1.1.1.1' },
      { ts: at(5), type: 'download_start', userId: 'a', url: 'https://youtube.com/reciente', ip: '2.2.2.2' },
    ];
    fs.writeFileSync(path.join(dir, 'audit.log'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\nlínea dañada\n`);
    const env = { ...process.env, DATA_DIR: dir };
    const total = () => execFileSync('node', ['-e', "console.log(require('./audit').totalDownloads())"], { cwd: BACKEND, env, encoding: 'utf8' }).trim();

    assert.equal(total(), '3', 'el total cuenta las 3 descargas (2 viejas + 1 reciente) y la limpieza corre al arrancar');
    const content = fs.readFileSync(path.join(dir, 'audit.log'), 'utf8');
    assert.doesNotMatch(content, /viejo1|viejo2|1\.1\.1\.1|dañada/, 'IP y enlaces viejos ya no están');
    assert.match(content, /reciente/);
    assert.match(content, /archive_marker/);
    assert.equal(total(), '3', 'reiniciar otra vez no cambia el total');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
