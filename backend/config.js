// Configuración del negocio. Los secretos (token del bot) van en backend/.env, nunca en el código.
const path = require('path');

// Vencimientos y "descargas de hoy" se cuentan en hora de México, sin importar la zona horaria del servidor
// (un VPS suele estar en UTC: el día terminaría a las 6 pm). Si TZ ya viene definida, se respeta.
process.env.TZ ??= 'America/Mexico_City';

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const ACCOUNT = (process.env.SELLER_ACCOUNT || '').trim();

module.exports = {
  // Bot de Telegram: créalo con @BotFather y pega el token en backend/.env (TELEGRAM_BOT_TOKEN=...).
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_API_URL: process.env.TELEGRAM_API_URL || 'https://api.telegram.org',
  // Quién recibe los avisos de pago. Debe escribirle /start al bot una vez para poder recibirlos.
  ADMIN_TELEGRAM: (process.env.ADMIN_TELEGRAM || 'tostilocos').replace(/^@/, '').toLowerCase(),
  // ID numérico de Telegram del administrador (opcional). Si no se pone, se fija solo la primera vez que el @usuario
  // de arriba le escribe al bot. Así, si ese @usuario cambia de dueño algún día, el nuevo dueño no obtiene permisos.
  ADMIN_TELEGRAM_ID: (process.env.ADMIN_TELEGRAM_ID || '').trim(),
  // Dirección pública de la app (se usa en los mensajes que recibe el cliente).
  PUBLIC_URL: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),
  SELLER: {
    name: 'DuoKit',
    // Cuenta donde se reciben las transferencias (SELLER_ACCOUNT en backend/.env). Una CLABE tiene 18 dígitos;
    // con 16 es una tarjeta de débito, y así se le nombra al cliente.
    account: ACCOUNT,
    accountLabel: ACCOUNT.replace(/\D/g, '').length === 18 ? 'CLABE' : 'tarjeta de débito',
    contact: '@tostilocos',
  },
};
