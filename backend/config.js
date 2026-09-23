// Configuración del negocio. Los secretos (claves de Mercado Pago) van en backend/.env, nunca en el código.
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
  // Dirección pública de la app: a donde Mercado Pago regresa al cliente después de pagar.
  PUBLIC_URL: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),
  // Cobro con tarjeta por Mercado Pago Checkout Pro: el cliente paga solo, sin esperar que el administrador
  // confirme a mano. MERCADOPAGO_ACCESS_TOKEN (APP_USR-... en producción, TEST-... para pruebas) se saca de
  // "Tus integraciones" en el panel de Mercado Pago. MERCADOPAGO_WEBHOOK_SECRET ("Clave secreta") se genera en la
  // misma sección, en Webhooks → Configurar notificaciones — es DISTINTA del access token y hace falta para
  // comprobar que un webhook de verdad viene de Mercado Pago. Sin el access token, Mercado Pago queda desactivado.
  MERCADOPAGO_ACCESS_TOKEN: (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim(),
  MERCADOPAGO_WEBHOOK_SECRET: (process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim(),
  // Dirección alternativa de la API de Mercado Pago: solo para pruebas (un Mercado Pago falso local), nunca en producción.
  MERCADOPAGO_API_BASE_URL: (process.env.MERCADOPAGO_API_BASE_URL || 'https://api.mercadopago.com').replace(/\/$/, ''),
  // Clave privada (Ed25519, PEM) para firmar los tickets de descarga que usa el Asistente de escritorio (ver
  // download-ticket.js y helper/). Tiene que ser SIEMPRE la que corresponde a la clave pública grabada en
  // helper/ticket-key.js — si se cambia una, hay que volver a construir el Asistente con la clave pública nueva.
  DOWNLOAD_TICKET_PRIVATE_KEY: (process.env.DOWNLOAD_TICKET_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim(),
  SELLER: {
    // Alias público del negocio. Nunca pongas aquí un nombre real: aparece en recibos y en el panel.
    name: (process.env.SELLER_NAME || 'DuoKit').trim(),
    // A dónde mandar a alguien que necesita ayuda (soporte, un pago que no se activó, perdió su contraseña y ya
    // cerró sesión en todos lados). Es un contacto manual, no automatizado: solo aparece en textos.
    contact: (process.env.SELLER_CONTACT || '@tostilocos').trim(),
  },
};
