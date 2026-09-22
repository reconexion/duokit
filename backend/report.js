// Resumen para el administrador (/resumen en el bot): cuántos pagos faltan por activar y cuántos ya se activaron.
const auth = require('./auth');
const payments = require('./payments');
const { PLANS, money } = require('./plans');

const DAY_MS = 86400000;
const EXPIRING_DAYS = 7; // clientes cuyo acceso vence en esta cantidad de días o menos
const MAX_PENDING_LISTED = 10; // el mensaje de Telegram no puede ser larguísimo

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const total = (list) => ({ count: list.length, amount: list.reduce((sum, p) => sum + p.amount, 0) });

// Calcula los números del resumen. `now` se puede pasar para probarlo con una fecha fija.
function summarize(now = new Date()) {
  const all = payments.list();
  const pending = all.filter((p) => p.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // los que llevan más tiempo, primero
  const paid = all.filter((p) => p.status === 'paid');
  const cancelled = all.filter((p) => p.status === 'cancelled');

  const dayStart = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const confirmedSince = (since) => paid.filter((p) => new Date(p.confirmedAt).getTime() >= since);

  const clients = auth.listUsers().filter((u) => u.role !== 'admin');
  const active = clients.filter((u) => u.status === 'active' && !u.expired);
  const daysLeft = (expiresAt) => {
    const [y, m, d] = expiresAt.split('-').map(Number);
    return Math.round((new Date(y, m - 1, d).getTime() - dayStart) / DAY_MS); // 0 = hoy es su último día
  };

  return {
    now,
    pending: { ...total(pending), reported: pending.filter((p) => p.reportedAt).length, list: pending },
    activated: {
      today: total(confirmedSince(dayStart)),
      month: total(confirmedSince(monthStart)),
      all: total(paid),
      byPlan: Object.fromEntries(Object.keys(PLANS).map((id) => [id, paid.filter((p) => p.plan === id).length])),
      recent: [...paid].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt)).slice(0, 5),
    },
    cancelled: cancelled.length,
    clients: {
      active: active.length,
      expiringSoon: active.filter((u) => u.expiresAt && daysLeft(u.expiresAt) <= EXPIRING_DAYS).length,
      banned: clients.filter((u) => u.status === 'banned').length,
    },
  };
}

function ago(iso, now) {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 60 * 24) return `hace ${Math.round(minutes / 60)} h`;
  const days = Math.round(minutes / (60 * 24));
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

const clientName = (p) => `${p.payerName || p.telegramName || 'Cliente'}${p.telegramUsername ? ` (@${p.telegramUsername})` : ''}`;
const planName = (p) => PLANS[p.plan]?.name || p.plan;
const line = (count, amount) => `${count} · ${money(amount)}`;

// Texto plano (sin formato de Telegram) para que ningún nombre de cliente pueda romper el mensaje.
function formatSummary(s) {
  const { now, pending, activated, clients } = s;
  const date = now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
  const out = ['📊 Resumen de duokit', `${date} · ${time}`, ''];

  if (pending.count === 0) {
    out.push('🕒 POR ACTIVAR: 0 — todo al día ✔');
  } else {
    const reported = pending.reported ? ` (${pending.reported} dice${pending.reported === 1 ? '' : 'n'} que ya pagó)` : '';
    out.push(`🕒 POR ACTIVAR: ${pending.count}${reported} · ${money(pending.amount)} por cobrar`);
    pending.list.slice(0, MAX_PENDING_LISTED).forEach((p, i) => {
      out.push(`${i + 1}. ${p.reference} · ${planName(p)} · ${money(p.amount)}`);
      out.push(`   ${clientName(p)} · ${p.reportedAt ? 'dice que ya pagó · ' : ''}${ago(p.createdAt, now)}`);
    });
    if (pending.count > MAX_PENDING_LISTED) out.push(`… y ${pending.count - MAX_PENDING_LISTED} más (usa /pendientes)`);
    out.push('Para activar: /confirmar REFERENCIA MONTO');
  }

  const plans = Object.entries(activated.byPlan).map(([id, n]) => `${PLANS[id].name} ${n}`).join(' · ');
  out.push('', '✅ ACTIVADOS');
  out.push(`Hoy: ${line(activated.today.count, activated.today.amount)}`);
  out.push(`Este mes: ${line(activated.month.count, activated.month.amount)}`);
  out.push(`Total: ${line(activated.all.count, activated.all.amount)}${activated.all.count ? ` (${plans})` : ''}`);
  if (activated.recent.length) {
    out.push('', 'Últimos activados:');
    for (const p of activated.recent) out.push(`• ${p.reference} · ${clientName(p)} · ${planName(p)} · ${ago(p.confirmedAt, now)}`);
  }

  out.push('', '👥 CLIENTES');
  out.push(`Activos: ${clients.active} · Vencen en ${EXPIRING_DAYS} días o menos: ${clients.expiringSoon} · Bloqueados: ${clients.banned}`);
  if (s.cancelled) out.push(`Pagos cancelados: ${s.cancelled}`);
  return out.join('\n');
}

module.exports = { summarize, formatSummary };
