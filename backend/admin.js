// API del panel de administración (/api/admin/*). Solo para el usuario con rol "admin".
const express = require('express');
const auth = require('./auth');
const audit = require('./audit');
const billing = require('./billing');
const payments = require('./payments');
const { planOf } = require('./plans');
const diagnose = require('./diagnose');

const router = express.Router();
router.use(auth.requireAdmin);

const publicPayment = (p) => ({
  reference: p.reference,
  plan: p.plan,
  amount: p.amount,
  status: p.status,
  telegramUsername: p.telegramUsername,
  telegramName: p.telegramName,
  payerName: p.payerName,
  createdAt: p.createdAt,
  reportedAt: p.reportedAt,
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
    users,
    pending: pending.map(publicPayment).reverse(),
    recentPaid: paid.map(publicPayment).reverse().slice(0, 10),
  });
});

router.post('/payments/:reference/confirm', async (req, res) => {
  try {
    const result = await billing.confirm(req.params.reference, `admin:${req.user.username}`);
    res.json({
      ok: true,
      reference: result.payment.reference,
      username: result.user.username,
      created: result.created,
      delivered: result.delivered,
      credentials: result.credentials, // solo si no se pudo avisar por Telegram
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
  if (user.telegramId) billing.getNotifier()?.notifyUser(user.telegramId, 'Tu cuenta de duokit fue suspendida. Escribe a @tostilocos si crees que fue un error.');
  res.json({ ok: true });
});

router.post('/users/:id/unban', (req, res) => {
  const user = targetUser(req, res);
  if (!user) return;
  auth.unbanUser(user.id);
  audit.log('user_unbanned', { userId: user.id, username: user.username, by: req.user.username });
  if (user.telegramId) billing.getNotifier()?.notifyUser(user.telegramId, 'Tu cuenta de duokit está activa otra vez. Ya puedes entrar.');
  res.json({ ok: true });
});

module.exports = router;
