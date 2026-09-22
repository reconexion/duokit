// Configuración del negocio. Los secretos (claves de Stripe) van en backend/.env, nunca en el código.
const path = require('path');

// Vencimientos y "descargas de hoy" se cuentan en hora de México, sin importar la zona horaria del servidor
// (un VPS suele estar en UTC: el día terminaría a las 6 pm). Si TZ ya viene definida, se respeta.
process.env.TZ ??= 'America/Mexico_City';

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

module.exports = {
  // Dirección pública de la app: a donde Stripe regresa al cliente después de pagar.
  PUBLIC_URL: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),
  // Cobro con tarjeta por Stripe Checkout: el cliente paga solo, sin esperar que el administrador confirme a mano.
  // STRIPE_SECRET_KEY (sk_test_/sk_live_) se saca del Dashboard de Stripe; STRIPE_WEBHOOK_SECRET (whsec_...) se
  // genera al crear el webhook que apunta a /api/webhook/stripe. Sin la clave secreta, Stripe queda desactivado.
  STRIPE_SECRET_KEY: (process.env.STRIPE_SECRET_KEY || '').trim(),
  STRIPE_WEBHOOK_SECRET: (process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
  // Host/puerto/protocolo alternativos para la API de Stripe: solo para pruebas (un Stripe falso local), nunca en producción.
  STRIPE_API_HOST: process.env.STRIPE_API_HOST || undefined,
  STRIPE_API_PORT: process.env.STRIPE_API_PORT || undefined,
  STRIPE_API_PROTOCOL: process.env.STRIPE_API_PROTOCOL || undefined,
  SELLER: {
    // Alias público del negocio. Nunca pongas aquí un nombre real: aparece en recibos y en el panel.
    name: (process.env.SELLER_NAME || 'DuoKit').trim(),
    // A dónde mandar a alguien que necesita ayuda (soporte, un pago que no se activó, perdió su contraseña y ya
    // cerró sesión en todos lados). Es un contacto manual, no automatizado: solo aparece en textos.
    contact: (process.env.SELLER_CONTACT || '@tostilocos').trim(),
  },
};
