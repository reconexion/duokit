// Pruebas del concepto de pago (referencia + nombre) y del resumen del administrador, con fechas y datos fijos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BACKEND = path.join(__dirname, '..');
const runIn = (dir, code) => execFileSync('node', ['-e', code], { cwd: BACKEND, env: { ...process.env, DATA_DIR: dir, TELEGRAM_BOT_TOKEN: '' }, encoding: 'utf8' });

test('el concepto lleva la referencia y el nombre, sin acentos ni símbolos y en máximo 40 caracteres', () => {
  const out = runIn(fs.mkdtempSync(path.join(os.tmpdir(), 'duokit-c-')), `
    const { paymentConcept } = require('./payments');
    const ref = 'DUO-2026-001';
    console.log(JSON.stringify([
      paymentConcept({ reference: ref, payerName: 'María López Ruiz' }),
      paymentConcept({ reference: ref, payerName: "Ñandú Peña-O'Brien" }),
      paymentConcept({ reference: ref, payerName: 'Juan Pérez' }),
      paymentConcept({ reference: ref, payerName: null }),
      paymentConcept({ reference: ref, payerName: 'Maximiliano Bartolomé de la Santísima Trinidad Hernández' }),
    ]));
  `);
  const [maria, enie, juan, none, long] = JSON.parse(out);
  assert.equal(maria, 'DUO-2026-001 MARIA LOPEZ RUIZ');
  assert.equal(enie, 'DUO-2026-001 NANDU PENAOBRIEN');
  assert.equal(juan, 'DUO-2026-001 JUAN PEREZ');
  assert.equal(none, 'DUO-2026-001', 'sin nombre queda solo la referencia');
  assert.ok(long.length <= 40 && long.startsWith('DUO-2026-001 MAXIMILIANO'), long);
});

const SETUP = `
  require('./config'); // fija la zona horaria de México antes de crear fechas
  const fs = require('fs'); const path = require('path');
  const dir = process.env.DATA_DIR;
  const at = (month, day, hour = 10) => new Date(2026, month, day, hour).toISOString();
  const pay = (reference, plan, status, extra = {}) => ({
    reference, plan, amount: plan === 'basic' ? 129 : 2999, status, telegramId: '1', telegramUsername: null, telegramName: 'X',
    payerName: 'Cliente ' + reference.slice(-3), createdAt: at(8, 20), reportedAt: null, confirmedAt: null, ...extra,
  });
  const user = (username, extra = {}) => ({ id: username, username, name: username, passwordHash: 'x', role: 'user', plan: 'basic', status: 'active', expiresAt: null, ...extra });
  const NOW = new Date(2026, 8, 21, 12, 0); // 21 de septiembre de 2026, 12:00
`;

test('el resumen cuenta pendientes, activados (hoy, mes y total), clientes y cancelados', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duokit-r-'));
  try {
    const out = runIn(dir, `${SETUP}
      fs.writeFileSync(path.join(dir, 'payments.json'), JSON.stringify([
        pay('DUO-2026-001', 'basic', 'paid', { confirmedAt: at(7, 31) }),                     // mes anterior
        pay('DUO-2026-002', 'lifetime', 'paid', { confirmedAt: at(8, 20) }),                   // este mes, no hoy
        pay('DUO-2026-003', 'basic', 'paid', { confirmedAt: at(8, 21, 9) }),                   // hoy
        pay('DUO-2026-004', 'basic', 'pending', { createdAt: at(8, 21, 8), reportedAt: at(8, 21, 11) }),
        pay('DUO-2026-005', 'lifetime', 'pending', { createdAt: at(8, 19) }),                  // el que más tiempo lleva esperando
        pay('DUO-2026-006', 'basic', 'cancelled'),
      ]));
      fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([
        user('admin', { role: 'admin', plan: 'lifetime' }),
        user('por_vencer', { expiresAt: '2026-09-24' }),
        user('tranquilo', { expiresAt: '2026-12-01' }),
        user('bloqueado', { status: 'banned' }),
        user('vencido', { expiresAt: '2026-01-01' }),
      ]));
      const report = require('./report');
      const s = report.summarize(NOW);
      console.log(JSON.stringify({ s: { ...s, pending: { ...s.pending, list: s.pending.list.map((p) => p.reference) }, activated: { ...s.activated, recent: s.activated.recent.map((p) => p.reference) } }, text: report.formatSummary(s) }));
    `);
    const { s, text } = JSON.parse(out);
    assert.deepEqual(s.pending, { count: 2, amount: 3128, reported: 1, list: ['DUO-2026-005', 'DUO-2026-004'] });
    assert.deepEqual(s.activated.today, { count: 1, amount: 129 });
    assert.deepEqual(s.activated.month, { count: 2, amount: 3128 });
    assert.deepEqual(s.activated.all, { count: 3, amount: 3257 });
    assert.deepEqual(s.activated.byPlan, { basic: 2, lifetime: 1 });
    assert.deepEqual(s.activated.recent, ['DUO-2026-003', 'DUO-2026-002', 'DUO-2026-001']);
    assert.equal(s.cancelled, 1);
    assert.deepEqual(s.clients, { active: 2, expiringSoon: 1, banned: 1 });

    assert.match(text, /POR ACTIVAR: 2 \(1 dice que ya pagó\) · \$3,128\.00 MXN por cobrar/);
    assert.match(text, /Hoy: 1 · \$129\.00 MXN/);
    assert.match(text, /Este mes: 2 · \$3,128\.00 MXN/);
    assert.match(text, /Total: 3 · \$3,257\.00 MXN \(Básico 2 · Permanente 1\)/);
    assert.match(text, /Activos: 2 · Vencen en 7 días o menos: 1 · Bloqueados: 1/);
    assert.match(text, /Pagos cancelados: 1/);
    assert.ok(text.indexOf('DUO-2026-005') < text.indexOf('DUO-2026-004'), 'el pendiente más antiguo va primero');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('el resumen sin datos dice "todo al día" y con muchos pendientes recorta la lista', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duokit-r-'));
  try {
    const empty = JSON.parse(runIn(dir, `${SETUP} const report = require('./report'); console.log(JSON.stringify(report.formatSummary(report.summarize(NOW))));`));
    assert.match(empty, /POR ACTIVAR: 0 — todo al día/);
    assert.match(empty, /Total: 0 · \$0\.00 MXN/);

    const many = JSON.parse(runIn(dir, `${SETUP}
      fs.writeFileSync(path.join(dir, 'payments.json'), JSON.stringify(Array.from({ length: 12 }, (_, i) => pay('DUO-2026-' + String(i + 1).padStart(3, '0'), 'basic', 'pending'))));
      const report = require('./report'); console.log(JSON.stringify(report.formatSummary(report.summarize(NOW))));`));
    assert.match(many, /POR ACTIVAR: 12/);
    assert.match(many, /y 2 más \(usa \/pendientes\)/);
    assert.ok(many.length < 3500, 'cabe en un mensaje de Telegram');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
