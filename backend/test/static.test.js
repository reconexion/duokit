// El backend, cuando existe un frontend ya compilado (DUOKIT_DIST_DIR), lo sirve él mismo — el despliegue de un solo
// servicio en Railway (sin nginx delante). Usa un dist/ de mentira, aislado, para no tocar el dist/ real del proyecto.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./helpers');

test('sirve el frontend compilado con reserva a index.html para las rutas de la SPA', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'duokit-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>duokit de prueba</title>');
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("hola")');

  const srv = await h.startServer({ DUOKIT_DIST_DIR: dist });
  try {
    for (const route of ['/', '/legal', '/admin', '/app', '/cualquier-cosa']) {
      const res = await fetch(`${srv.base}${route}`);
      assert.equal(res.status, 200, route);
      assert.match(await res.text(), /duokit de prueba/, route);
    }
    const asset = await fetch(`${srv.base}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /console\.log/, 'el archivo real se sirve tal cual, no el index.html');

    const api = await h.client(srv).get('/api/auth/me');
    assert.equal(api.status, 401, 'la API sigue respondiendo JSON, no cae en el index.html');
    const missing = await h.client(srv).get('/api/nada');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, 'No encontrado.');
  } finally {
    srv.stop();
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('sin frontend compilado, las rutas que no son de la API dan 404 JSON (como en desarrollo, con Vite aparte)', async () => {
  const srv = await h.startServer({ DUOKIT_DIST_DIR: path.join(os.tmpdir(), 'duokit-dist-inexistente') });
  try {
    const res = await h.client(srv).get('/legal');
    assert.equal(res.status, 404);
    assert.equal(res.json.error, 'No encontrado.');
  } finally {
    srv.stop();
  }
});
