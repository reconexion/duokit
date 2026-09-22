// Cobro con tarjeta por Stripe Checkout: el sitio manda al cliente directo a pagar; Stripe avisa por webhook cuando
// se paga (checkout.session.completed) y ahí se activa la cuenta, sin que el administrador confirme nada a mano.
const Stripe = require('stripe');
const config = require('./config');
const { PLANS } = require('./plans');

const enabled = Boolean(config.STRIPE_SECRET_KEY);

// STRIPE_API_HOST/PORT/PROTOCOL solo existen en las pruebas, para hablarle a un Stripe falso local en vez del real.
const client = enabled
  ? new Stripe(config.STRIPE_SECRET_KEY, {
      ...(config.STRIPE_API_HOST ? { host: config.STRIPE_API_HOST, port: Number(config.STRIPE_API_PORT), protocol: config.STRIPE_API_PROTOCOL } : {}),
    })
  : null;

// Crea la sesión de pago (checkout hospedado por Stripe) para una referencia ya creada en payments.js.
// `reference` viaja en los metadatos: es lo único que el webhook necesita para saber qué pago activar.
// El correo lo pide Stripe siempre (es obligatorio para pagar con tarjeta); billing_address_collection hace que
// también pida el nombre (y una dirección) — así no hace falta un formulario propio antes de mandar a pagar.
//
// NO PROBADO contra la API real de Stripe (este entorno no tiene claves de verdad). Antes de usarlo en producción,
// prueba un pago completo con una clave de prueba (sk_test_...) y revisa que el webhook traiga customer_details.email
// y customer_details.name como se espera aquí.
async function createCheckoutSession({ reference, plan }) {
  if (!enabled) throw new Error('Stripe no está configurado (falta STRIPE_SECRET_KEY en backend/.env).');
  const info = PLANS[plan];
  return client.checkout.sessions.create({
    mode: 'payment',
    // La referencia interna viaja como client_reference_id (para verla fácil en el Dashboard de Stripe) y en
    // metadata (lo que de verdad lee el webhook: client_reference_id no siempre llega igual en todos los eventos).
    client_reference_id: reference,
    metadata: { reference, plan },
    billing_address_collection: 'required',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'mxn',
          unit_amount: Math.round(info.price * 100), // Stripe cobra en centavos
          product_data: { name: `duokit · ${info.name}` },
        },
      },
    ],
    // {CHECKOUT_SESSION_ID} lo rellena el propio Stripe al redirigir: así la pantalla de "pago exitoso" sabe cuál
    // sesión consultar para mostrar las credenciales (ver /api/checkout-status/:sessionId en server.js).
    success_url: `${config.PUBLIC_URL}/pago?estado=exito&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.PUBLIC_URL}/pago?estado=cancelado`,
  });
}

// Verifica que el webhook de verdad viene de Stripe (firma HMAC con STRIPE_WEBHOOK_SECRET) antes de confiar en nada
// de lo que dice. `rawBody` debe ser el cuerpo tal cual llegó (Buffer), sin pasar por express.json().
// Es una verificación local (crypto puro, sin llamar a la red de Stripe), así que no hace falta un cliente configurado.
function verifyWebhookEvent(rawBody, signatureHeader) {
  if (!config.STRIPE_WEBHOOK_SECRET) throw new Error('Falta STRIPE_WEBHOOK_SECRET en backend/.env.');
  return Stripe.webhooks.constructEvent(rawBody, signatureHeader, config.STRIPE_WEBHOOK_SECRET);
}

module.exports = { enabled, createCheckoutSession, verifyWebhookEvent };
