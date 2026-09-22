// API del panel de administración (/api/admin/*). Solo para el usuario con rol "admin".
const express = require('express');
const auth = require('./auth');
const audit = require('./audit');
const billing = require('./billing');
const payments = require('./payments');
const { planOf } = require('./plans');
const diagnose = require('./diagnose');
const health = require('./health');

const router = express.Router();
router.use(auth.requireAdmin);

const publicPayment = (p) => ({
  reference: p.reference,
  plan: p.plan,
  amount: p.amount,
  status: p.status,
  email: p.email,
  payerName: p.payerName,
  createdAt: p.createdAt,
  confirmedAt: p.confirmedAt,
  username: p.username,
  termsAcceptedAt: p.termsAcceptedAt || null,
});

// Prueba varias formas de hablarle a YouTube desde este servidor y dice cuál (si alguna) evita el bloqueo de IP de nube.
// No descarga nada real (--simulate); tarda unos segundos porque prueba varias opciones una por una.
router.get('/ytdlp-diagnose', async (req, res) => {
  res.json(await diagnose.diagnose());
});

router.get('/summary', (req, res) => {
  const users = auth.listUsers().map((u) => ({
    ...u,
    planName: planOf(u).name,
    downloadsToday: audit.downloadsToday(u.id),
    sessions: auth.activeSessionCount(u.id),
  }));
  const all = payments.list();
  const pending = all.filter((p) => p.status === 'pending');
  const paid = all.filter((p) => p.status === 'paid');

  res.json({
    stats: {
      revenue: payments.revenue(),
      paidCount: paid.length,
      pendingCount: pending.length,
      downloadsTotal: audit.totalDownloads(),
      downloadsToday: audit.totalDownloadsToday(),
      activeUsers: users.filter((u) => u.role !== 'admin' && u.status === 'active' && !u.expired).length,
      bannedUsers: users.filter((u) => u.status === 'banned').length,
    },
    // Sin Telegram nadie te avisa en el momento: revisa esto de vez en cuando. Si no es null, varias descargas
    // seguidas están fallando por YouTube/yt-dlp — suele arreglarse con `pipx upgrade yt-dlp`.
    serviceAlert: health.status(),
    users,
    pending: pending.map(publicPayment).reverse(),
    recentPaid: paid.map(publicPayment).reverse().slice(0, 10),
  });
});

// Respaldo de emergencia: normalmente Mercado Pago confirma solo, por el webhook. Esto es solo por si algún día falla.
router.post('/payments/:reference/confirm', async (req, res) => {
  try {
    const result = await billing.confirm(req.params.reference, `admin:${req.user.username}`);
    res.json({
      ok: true,
      reference: result.payment.reference,
      username: result.user.username,
      created: result.created,
      // La contraseña solo viaja aquí si la cuenta se acaba de crear: no hay Telegram/correo para mandarla sola,
      // así que el panel se la muestra al administrador para que se la dé al cliente por el medio que lo contactó.
      password: result.created ? result.password : null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/payments/:reference/cancel', (req, res) => {
  try {
    const payment = billing.cancel(req.params.reference);
    res.json({ ok: true, reference: payment.reference });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function targetUser(req, res) {
  const user = auth.findUserById(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'No existe ese usuario.' });
    return null;
  }
  if (user.role === 'admin') {
    res.status(400).json({ error: 'No se puede bloquear al administrador.' });
    return null;
  }
  return user;
}

router.post('/users/:id/ban', (req, res) => {
  const user = targetUser(req, res);
  if (!user) return;
  const reason = String(req.body?.reason || '').slice(0, 200) || 'Bloqueado por el administrador';
  auth.banUser(user.id, reason);
  audit.log('user_banned', { userId: user.id, username: user.username, by: req.user.username, reason });
  res.json({ ok: true });
});

router.post('/users/:id/unban', (req, res) => {
  const user = targetUser(req, res);
  if (!user) return;
  auth.unbanUser(user.id);
  audit.log('user_unbanned', { userId: user.id, username: user.username, by: req.user.username });
  res.json({ ok: true });
});

// Restablecimiento manual: para cuando un cliente perdió su contraseña y no puede generarse una nueva él mismo
// (porque eso requiere estar logueado, ver /api/account/reset-password). El administrador ve la contraseña nueva
// una vez y se la da al cliente por el medio que use para contactarlo.
router.post('/users/:id/reset-password', async (req, res) => {
  const user = targetUser(req, res);
  if (!user) return;
  const password = auth.generatePassword();
  await auth.setPassword(user.id, password);
  auth.revokeUserSessions(user.id);
  audit.log('password_reset', { userId: user.id, username: user.username, by: `admin:${req.user.username}` });
  res.json({ ok: true, username: user.username, password });
});

module.exports = router;
