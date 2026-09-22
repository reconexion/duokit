// Cobro con tarjeta por Mercado Pago Checkout Pro: el sitio manda al cliente directo a pagar; Mercado Pago avisa
// por webhook cuando el pago se resuelve y ahí se activa la cuenta, sin que el administrador confirme nada a mano.
//
// Las llamadas a la API (crear preferencia, consultar un pago) son fetch() directo a MERCADOPAGO_API_BASE_URL, no
// el cliente REST del SDK oficial: el SDK no admite apuntar a otro host, y las pruebas de este proyecto necesitan
// hablarle a un Mercado Pago falso en local (igual que se hacía con STRIPE_API_HOST antes). Sí se usa el SDK oficial
// para la firma del webhook (WebhookSignatureValidator): es criptografía pura, sin red, y reimplementarla a mano
// es fácil de hacer mal (el propio SDK de Mercado Pago para Java tuvo un bug ahí — issue #420 en su repo).
//
// NO PROBADO contra la API real de Mercado Pago (este entorno no tiene un pago real hecho de punta a punta).
// Antes de vender de verdad, haz una compra completa con las credenciales reales y revisa que el webhook llegue
// (deploy/RAILWAY.md tiene el checklist).
const { WebhookSignatureValidator, InvalidWebhookSignatureError } = require('mercadopago');
const config = require('./config');
const { PLANS } = require('./plans');

const enabled = Boolean(config.MERCADOPAGO_ACCESS_TOKEN);
const API_BASE = config.MERCADOPAGO_API_BASE_URL;

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.MERCADOPAGO_ACCESS_TOKEN}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `Mercado Pago respondió ${res.status} en ${path}`);
  return body;
}

// Crea la preferencia de pago (checkout hospedado por Mercado Pago) para una referencia ya creada en payments.js.
// `checkoutToken` viaja como external_reference: es un id aparte, largo y al azar (no la referencia interna
// DUO-2026-NNN, que es secuencial y por tanto adivinable) — con eso, y solo eso, el webhook sabe qué pago activar
// y la pantalla de "pago exitoso" puede consultar el estado sin que nadie más lo adivine.
//
// binary_mode:true hace que el pago quede aprobado o rechazado al momento, nunca "pendiente" — así se excluyen los
// métodos que tardan días en resolverse (como pagar en efectivo en OXXO), que no encajan con "tu cuenta está lista
// al momento" que el sitio promete. Si algún día se quiere aceptar esos métodos, hay que rediseñar la pantalla de
// "pago exitoso" para mostrar instrucciones de pago pendiente, no solo activar o no.
async function createPreference({ checkoutToken, plan }) {
  if (!enabled) throw new Error('Mercado Pago no está configurado (falta MERCADOPAGO_ACCESS_TOKEN en backend/.env).');
  const info = PLANS[plan];
  const returnUrl = `${config.PUBLIC_URL}/pago?estado=exito&checkout=${checkoutToken}`;
  return request('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ title: `duokit · ${info.name}`, quantity: 1, unit_price: info.price, currency_id: 'MXN' }],
      external_reference: checkoutToken,
      notification_url: `${config.PUBLIC_URL}/api/webhook/mercadopago`,
      back_urls: { success: returnUrl, pending: returnUrl, failure: `${config.PUBLIC_URL}/pago?estado=cancelado` },
      auto_return: 'approved',
      binary_mode: true,
    }),
  });
}

// Trae el pago real desde la API: nunca se confía en lo que venga en el cuerpo del webhook (Mercado Pago solo
// avisa "hay novedades"; el estado de verdad se pide aparte, con el id que trae la notificación).
async function retrievePayment(paymentId) {
  return request(`/v1/payments/${encodeURIComponent(paymentId)}`);
}

// Verifica que el webhook de verdad viene de Mercado Pago (firma HMAC-SHA256 con MERCADOPAGO_WEBHOOK_SECRET) antes
// de confiar en nada de lo que dice. Es una verificación local (crypto puro), no hace falta llamar a la red.
function verifyWebhookSignature({ xSignature, xRequestId, dataId }) {
  if (!config.MERCADOPAGO_WEBHOOK_SECRET) throw new Error('Falta MERCADOPAGO_WEBHOOK_SECRET en backend/.env.');
  WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId, secret: config.MERCADOPAGO_WEBHOOK_SECRET });
}

module.exports = { enabled, createPreference, retrievePayment, verifyWebhookSignature, InvalidWebhookSignatureError };
