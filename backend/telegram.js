// Bot de Telegram (long polling, sin librerías): /comprar genera la referencia y el recibo,
// avisa al administrador y, al confirmarse el pago, entrega el usuario y la contraseña.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const auth = require('./auth');
const billing = require('./billing');
const payments = require('./payments');
const { buildReceipt } = require('./receipts');
const { PLANS, money } = require('./plans');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'telegram.json');
const enabled = Boolean(config.TELEGRAM_BOT_TOKEN);

let state = { offset: 0, adminChatId: null, adminId: null };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
} catch {
  /* primera vez */
}
// En un chat privado el id del chat es el id del usuario: si el admin ya había escrito antes, queda fijado.
state.adminId ??= state.adminChatId;
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });

// ---------------------------------------------------------------------------
// API de Telegram
// ---------------------------------------------------------------------------

async function call(method, params = {}, { formData, timeoutMs = 20000 } = {}) {
  let res;
  try {
    res = await fetch(`${config.TELEGRAM_API_URL}/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: formData ? undefined : { 'Content-Type': 'application/json' },
      body: formData || JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // El mensaje de red no incluye la URL, así el token nunca termina en los logs.
    throw new Error(`Telegram ${method}: ${err.cause?.code || err.name}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  return data.result;
}

const sendMessage = (chatId, text, extra = {}) => call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...extra });

function sendPdf(chatId, buffer, filename, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('document', new Blob([buffer], { type: 'application/pdf' }), filename);
  return call('sendDocument', {}, { formData: form, timeoutMs: 60000 });
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

const PLANS_TEXT = `Planes de duokit

🟢 Básico — ${money(PLANS.basic.price)} al mes
• ${PLANS.basic.days} días de acceso
• Video hasta ${PLANS.basic.qualityLabel}
• Hasta ${PLANS.basic.dailyLimit} descargas al día

⭐ Permanente — ${money(PLANS.lifetime.price)}, pago único
• Acceso de por vida
• Video hasta ${PLANS.lifetime.qualityLabel}
• Hasta ${PLANS.lifetime.dailyLimit} descargas al día

Compras finales: no hay reembolsos. Al comprar aceptas los términos: ${config.PUBLIC_URL}/legal

Elige tu plan:`;

const HELP_TEXT = `Hola, soy el bot de duokit: descarga videos, audio y miniaturas de YouTube desde tu navegador.

/comprar — ver los planes y comprar
/estado — ver tu plan y hasta cuándo tienes acceso
/recuperar — generar una contraseña nueva

Pagas por transferencia (SPEI) y en cuanto confirmamos tu pago te llegan tu usuario y contraseña por aquí.`;

const PLAN_KEYBOARD = {
  inline_keyboard: [
    [{ text: `Básico · $${PLANS.basic.price} MXN/mes`, callback_data: 'buy:basic' }],
    [{ text: `Permanente · $${PLANS.lifetime.price.toLocaleString('es-MX')} MXN`, callback_data: 'buy:lifetime' }],
  ],
};

const formatDay = (yyyyMmDd) => {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
};

const accessLine = (user) => (user.expiresAt ? `hasta el ${formatDay(user.expiresAt)}` : 'de por vida');
const fullName = (from) => [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Cliente';
// Quién es el cliente en los avisos al administrador: el nombre que dio y, entre paréntesis, su Telegram.
const describe = (p) => `${p.payerName || p.telegramName || 'Cliente'} (${p.telegramUsername ? `@${p.telegramUsername}` : `Telegram: ${p.telegramName || p.telegramId}`})`;

const NAME_PATTERN = /^[\p{L}][\p{L}\p{M} .'-]{2,59}$/u;
const NAME_PROMPT = 'Para saber quién hace el pago, escribe tu nombre completo, como aparece en tu banco.\n\nEjemplo: Juan Pérez';
const awaitingName = new Map(); // chat -> plan que quería comprar

// El administrador se reconoce por su ID numérico, que no se puede heredar (un @usuario sí puede cambiar de dueño).
// Si no hay ID configurado, la primera vez que el @usuario del administrador escribe se guarda su ID y desde entonces solo vale ese.
function isAdminUser(from) {
  if (config.ADMIN_TELEGRAM_ID) return String(from.id) === config.ADMIN_TELEGRAM_ID;
  if (state.adminId) return String(from.id) === String(state.adminId);
  if (from.username && from.username.toLowerCase() === config.ADMIN_TELEGRAM) {
    state.adminId = from.id;
    saveState();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

let warnedNoAdmin = false;
async function notifyAdmin(text) {
  if (!state.adminChatId) {
    if (!warnedNoAdmin) console.warn(`Telegram: @${config.ADMIN_TELEGRAM} debe escribirle /start al bot para recibir avisos.`);
    warnedNoAdmin = true;
    return false;
  }
  try {
    await sendMessage(state.adminChatId, text);
    return true;
  } catch (err) {
    console.error('No se pudo avisar al administrador:', err.message);
    return false;
  }
}

async function notifyUser(telegramId, text) {
  try {
    await sendMessage(telegramId, text);
    return true;
  } catch (err) {
    console.error('No se pudo escribir al cliente:', err.message);
    return false;
  }
}

// Entrega al cliente sus datos de acceso y el recibo pagado. Devuelve true si el mensaje llegó.
async function deliverActivation({ payment, user, password, created, accessUntil }) {
  const access = accessUntil === null && user.plan === 'lifetime' ? 'de por vida' : accessLine(user);
  const lines = created
    ? [
        '✅ ¡Pago confirmado! Tu acceso a duokit ya está activo.',
        '',
        `Entra aquí: ${config.PUBLIC_URL}/app`,
        `Usuario: ${user.username}`,
        `Contraseña: ${password}`,
        '',
        `Plan: ${PLANS[user.plan].name} · acceso ${access}`,
        'Guarda estos datos. Si olvidas tu contraseña, escríbeme /recuperar.',
      ]
    : [
        '✅ ¡Pago confirmado! Actualizamos tu acceso a duokit.',
        '',
        `Entra aquí: ${config.PUBLIC_URL}/app`,
        `Usuario: ${user.username} (tu contraseña sigue igual)`,
        `Plan: ${PLANS[user.plan].name} · acceso ${access}`,
      ];
  const ok = await notifyUser(payment.telegramId, lines.join('\n'));
  if (!ok) return false;
  try {
    const pdf = await buildReceipt(payment, 'paid');
    await sendPdf(payment.telegramId, pdf, `recibo-${payment.reference}.pdf`, `Recibo ${payment.reference}`);
  } catch (err) {
    console.error('No se pudo enviar el recibo:', err.message);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

async function startBuy(chatId, from, planId, givenName) {
  const plan = PLANS[planId];
  const existing = auth.findUserByTelegramId(from.id);
  if (existing?.plan === 'lifetime') {
    return sendMessage(chatId, 'Ya tienes acceso permanente a duokit 🎉 No necesitas comprar nada más. Usa /estado para ver tu cuenta.');
  }
  if (existing?.status === 'banned') {
    return sendMessage(chatId, `Tu cuenta está suspendida. Escribe a ${config.SELLER.contact} para aclararlo.`);
  }
  if (!config.SELLER.account) {
    return sendMessage(chatId, `Las compras no están disponibles por ahora. Escribe a ${config.SELLER.contact}.`);
  }

  // El nombre real permite reconocer la transferencia en el estado de cuenta: se pide la primera vez.
  const payerName = givenName || payments.knownName(from.id);
  if (!payerName) {
    awaitingName.set(chatId, planId);
    return sendMessage(chatId, NAME_PROMPT);
  }

  const { payment, reused } = payments.create({
    plan: planId,
    telegramId: from.id,
    telegramUsername: from.username,
    telegramName: fullName(from),
    payerName,
  });

  await sendMessage(
    chatId,
    [
      `Tu referencia: ${payment.reference}`,
      `Cliente: ${payment.payerName}`,
      `Plan: ${plan.name} — ${money(payment.amount)}`,
      '',
      `Transfiere ${money(payment.amount)} a esta ${config.SELLER.accountLabel}: ${config.SELLER.account} con referencia: ${payment.reference}`,
      '',
      'Te mando tu recibo en PDF. Cuando hagas la transferencia toca "Ya pagué" y lo revisamos.',
      `Recuerda: las compras son finales (no hay reembolsos). Términos: ${config.PUBLIC_URL}/legal`,
    ].join('\n'),
    {
      reply_markup: {
        inline_keyboard: [[
          { text: 'Ya pagué ✅', callback_data: `paid:${payment.reference}` },
          { text: 'Cancelar', callback_data: `cancel:${payment.reference}` },
        ]],
      },
    },
  );
  await sendPdf(chatId, await buildReceipt(payment, 'pending'), `recibo-${payment.reference}.pdf`, `Recibo ${payment.reference} (pendiente de pago)`);

  if (!reused) {
    await notifyAdmin(
      [
        '🕒 Pago pendiente',
        `${payment.reference} · ${plan.name} · ${money(payment.amount)}`,
        `Cliente: ${describe(payment)}`,
        '',
        `Cuando llegue la transferencia: /confirmar ${payment.reference} ${payment.amount}`,
      ].join('\n'),
    );
  }
}

async function reportPaid(chatId, from, reference) {
  const payment = payments.get(reference);
  if (!payment || payment.telegramId !== String(from.id)) return sendMessage(chatId, 'No encontré ese pago.');
  if (payment.status !== 'pending') return sendMessage(chatId, `El pago ${payment.reference} ya está ${payment.status === 'paid' ? 'confirmado' : 'cancelado'}.`);
  payments.update(payment.reference, { reportedAt: new Date().toISOString() });
  await sendMessage(chatId, `Gracias. Estamos revisando tu pago ${payment.reference}; en cuanto lo confirmemos te mando tu acceso por aquí.`);
  await notifyAdmin(
    [
      '💰 El cliente dice que ya pagó',
      `${payment.reference} · ${PLANS[payment.plan].name} · ${money(payment.amount)}`,
      `Cliente: ${describe(payment)}`,
      '',
      `Si ya llegó la transferencia: /confirmar ${payment.reference} ${payment.amount}`,
    ].join('\n'),
  );
}

async function cancelPayment(chatId, from, reference) {
  const payment = payments.get(reference);
  if (!payment || payment.telegramId !== String(from.id)) return sendMessage(chatId, 'No encontré ese pago.');
  if (payment.status !== 'pending') return sendMessage(chatId, `El pago ${payment.reference} ya no está pendiente.`);
  billing.cancel(payment.reference);
  return sendMessage(chatId, `Cancelé la referencia ${payment.reference}. Cuando quieras comprar de nuevo, usa /comprar.`);
}

function statusText(from) {
  const user = auth.findUserByTelegramId(from.id);
  if (!user) return 'Aún no tienes cuenta en duokit. Usa /comprar para ver los planes.';
  const state = user.status === 'banned' ? 'suspendida' : auth.isExpired(user) ? 'vencida' : 'activa';
  return [`Usuario: ${user.username}`, `Plan: ${PLANS[user.plan]?.name || 'Básico'}`, `Acceso: ${accessLine(user)}`, `Estado: ${state}`, '', `Entra aquí: ${config.PUBLIC_URL}/app`].join('\n');
}

const lastReset = new Map();
async function resetPassword(chatId, from) {
  const user = auth.findUserByTelegramId(from.id);
  if (!user) return sendMessage(chatId, 'Aún no tienes cuenta en duokit. Usa /comprar para ver los planes.');
  if (user.status === 'banned') return sendMessage(chatId, `Tu cuenta está suspendida. Escribe a ${config.SELLER.contact}.`);
  if (Date.now() - (lastReset.get(from.id) || 0) < 60000) return sendMessage(chatId, 'Espera un minuto antes de pedir otra contraseña.');
  lastReset.set(from.id, Date.now());
  const password = auth.generatePassword();
  await auth.setPassword(user.id, password);
  auth.revokeUserSessions(user.id); // quien tuviera la contraseña anterior (un dispositivo perdido, alguien más) queda fuera
  return sendMessage(chatId, `Listo. Tu contraseña nueva:\n\nUsuario: ${user.username}\nContraseña: ${password}\n\nLa anterior ya no funciona y se cerraron las sesiones abiertas: vuelve a entrar con estos datos.`);
}

// Solo el administrador (@tostilocos)
async function adminCommand(chatId, command, arg) {
  if (command === '/pendientes') {
    const pending = payments.list().filter((p) => p.status === 'pending');
    if (pending.length === 0) return sendMessage(chatId, 'No hay pagos pendientes.');
    return sendMessage(
      chatId,
      pending
        .map((p) => `${p.reference} · ${PLANS[p.plan].name} · ${money(p.amount)} · ${describe(p)}${p.reportedAt ? ' · dice que ya pagó' : ''}`)
        .join('\n') + '\n\nPara activar: /confirmar REFERENCIA MONTO',
    );
  }
  if (command === '/confirmar') {
    const [reference, amountText] = String(arg).trim().split(/\s+/);
    if (!reference) return sendMessage(chatId, 'Uso: /confirmar REFERENCIA MONTO\nEjemplo: /confirmar DUO-2026-001 129');
    // El monto que escribes es el que viste llegar al banco: evita activar el plan equivocado ($129 vs $2,999) por un descuido.
    const payment = payments.get(reference);
    if (payment) {
      const received = Number(String(amountText ?? '').replace(/mxn|[$,\s]/gi, ''));
      if (!amountText || !Number.isFinite(received)) {
        return sendMessage(chatId, `Antes de activar, escribe el monto que te llegó al banco.\n${payment.reference} es ${PLANS[payment.plan].name}: ${money(payment.amount)}.\n\n/confirmar ${payment.reference} ${payment.amount}`);
      }
      if (received !== payment.amount) {
        return sendMessage(chatId, `El monto no coincide: ${payment.reference} es ${PLANS[payment.plan].name} por ${money(payment.amount)} y escribiste ${money(received)}. No lo activé.`);
      }
    }
    try {
      const result = await billing.confirm(reference, 'telegram');
      return sendMessage(
        chatId,
        `✅ ${result.payment.reference} confirmado. ${result.created ? 'Usuario creado' : 'Acceso actualizado'}: ${result.user.username}. ` +
          (result.delivered ? 'Ya le mandé sus datos por Telegram.' : `No pude escribirle al cliente. Dale sus datos por otro medio${result.credentials ? `: ${result.credentials.username} / ${result.credentials.password}` : '.'}`),
      );
    } catch (err) {
      return sendMessage(chatId, `No se pudo confirmar: ${err.message}`);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entrada de mensajes
// ---------------------------------------------------------------------------

const hits = new Map(); // freno anti-spam: máx. 30 mensajes por minuto y persona
function throttled(userId) {
  const now = Date.now();
  const recent = (hits.get(userId) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 30;
}

async function handleMessage(message) {
  if (message.chat.type !== 'private' || !message.from || message.from.is_bot) return;
  const chatId = message.chat.id;
  const from = message.from;
  if (throttled(from.id)) return;

  const admin = isAdminUser(from);
  if (admin && state.adminChatId !== chatId) {
    state.adminChatId = chatId;
    saveState();
  }

  // Si el bot está esperando el nombre para generar la referencia, lo siguiente que escriba es ese nombre.
  const typed = String(message.text || '').trim();
  if (awaitingName.has(chatId)) {
    if (typed.startsWith('/')) {
      awaitingName.delete(chatId); // eligió otro comando: se cancela la compra en curso
    } else {
      const name = typed.replace(/\s+/g, ' ');
      if (!NAME_PATTERN.test(name)) return sendMessage(chatId, `No pude leer ese nombre. Escribe solo tu nombre y apellido, sin números ni símbolos.\n\nEjemplo: Juan Pérez`);
      const planId = awaitingName.get(chatId);
      awaitingName.delete(chatId);
      return startBuy(chatId, from, planId, name);
    }
  }

  const [rawCommand, ...rest] = String(message.text || '').trim().split(/\s+/);
  const command = rawCommand.toLowerCase().replace(/@\w+$/, '');
  const arg = rest.join(' ');

  if (command === '/start' || command === '/ayuda' || command === '/help') {
    await sendMessage(chatId, HELP_TEXT);
    if (admin) await sendMessage(chatId, 'Eres el administrador: te avisaré aquí de cada pago pendiente.\n\n/pendientes — ver pagos pendientes\n/confirmar REFERENCIA MONTO — activar a un cliente (el monto es lo que te llegó al banco)');
    return;
  }
  if (command === '/comprar') return sendMessage(chatId, PLANS_TEXT, { reply_markup: PLAN_KEYBOARD });
  if (command === '/estado') return sendMessage(chatId, statusText(from));
  if (command === '/recuperar') return resetPassword(chatId, from);
  if (admin && (command === '/pendientes' || command === '/confirmar')) return adminCommand(chatId, command, arg);
  return sendMessage(chatId, 'No entendí ese mensaje. Usa /comprar para ver los planes o /estado para ver tu acceso.');
}

async function handleCallback(query) {
  const from = query.from;
  const chatId = query.message?.chat?.id;
  if (!chatId || query.message.chat.type !== 'private' || throttled(from.id)) return;
  await call('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  const [action, value] = String(query.data || '').split(':');
  if (action === 'buy' && PLANS[value]) return startBuy(chatId, from, value);
  if (action === 'paid') return reportPaid(chatId, from, value);
  if (action === 'cancel') return cancelPayment(chatId, from, value);
  return null;
}

async function handleUpdate(update) {
  if (update.message) return handleMessage(update.message);
  if (update.callback_query) return handleCallback(update.callback_query);
  return null;
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll() {
  let failures = 0;
  for (;;) {
    try {
      const updates = await call('getUpdates', { offset: state.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, { timeoutMs: 40000 });
      failures = 0;
      for (const update of updates) {
        state.offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (err) {
          console.error('Telegram (mensaje):', err.message);
        }
      }
      if (updates.length) saveState();
    } catch (err) {
      failures += 1;
      console.error(err.message);
      await sleep(Math.min(30000, 1000 * 2 ** failures));
    }
  }
}

async function start() {
  if (!enabled) {
    console.log('Telegram desactivado: falta TELEGRAM_BOT_TOKEN en backend/.env (créalo con @BotFather).');
    return;
  }
  try {
    const me = await call('getMe');
    console.log(`Bot de Telegram activo: @${me.username}`);
    await call('setMyCommands', {
      commands: [
        { command: 'comprar', description: 'Ver los planes y comprar' },
        { command: 'estado', description: 'Ver mi plan y mi acceso' },
        { command: 'recuperar', description: 'Generar una contraseña nueva' },
        { command: 'ayuda', description: 'Cómo funciona' },
      ],
    }).catch(() => {});
  } catch (err) {
    console.error(`Telegram desactivado: ${err.message}. Revisa el token.`);
    return;
  }
  billing.setNotifier({ deliverActivation, notifyAdmin, notifyUser });
  poll();
}

module.exports = { start, notifyAdmin, notifyUser, enabled };
