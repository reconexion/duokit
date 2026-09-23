// Tickets firmados y de un solo uso para el Asistente de duokit (el programa que corre en la compu del cliente,
// ver /helper): el servidor sigue siendo el ÚNICO que decide SI se puede descargar (límites del plan, tope diario,
// bloqueo automático, calidad máxima) — el Asistente solo ejecuta lo que el servidor ya autorizó, nunca decide
// nada por su cuenta. Sin esto, cualquiera podría usar el Asistente para saltarse los límites de su plan.
//
// Firma asimétrica (Ed25519), no un secreto compartido: el Asistente se reparte a cualquiera (está en helper/,
// código abierto en este mismo repo), así que solo puede llevar la CLAVE PÚBLICA — si llevara un secreto HMAC,
// cualquiera podría sacarlo del binario y fabricar sus propios tickets. Con Ed25519, solo este servidor (que tiene
// la clave PRIVADA, en backend/.env) puede firmar tickets válidos; el Asistente solo verifica.
const crypto = require('crypto');
const config = require('./config');

const TTL_MS = 2 * 60 * 1000; // 2 min: de sobra para que el Asistente reciba el ticket y arranque, no para reusarlo después
const usedNonces = new Set();

function privateKey() {
  return crypto.createPrivateKey(config.DOWNLOAD_TICKET_PRIVATE_KEY);
}

// Crea un ticket para exactamente esta descarga (ya validada y con los límites del plan aplicados por quien llama).
function issue(payload) {
  const body = { ...payload, nonce: crypto.randomUUID(), exp: Date.now() + TTL_MS };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const signature = crypto.sign(null, Buffer.from(encoded), privateKey()).toString('base64url');
  return `${encoded}.${signature}`;
}

module.exports = { issue, TTL_MS, usedNonces };
