// Clave PÚBLICA que corresponde a DOWNLOAD_TICKET_PRIVATE_KEY en backend/.env (Ed25519). Es pública a propósito:
// este archivo se reparte con el Asistente a cualquiera, así que solo puede verificar tickets, nunca fabricarlos.
// Si la clave privada del servidor cambia, esta también tiene que cambiar (y reconstruir el Asistente) — si no,
// el Asistente rechazaría TODOS los tickets nuevos con "firma inválida".
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADnzHaZ+avkeNzkNB/oQ/zDrevTx1FCdqZG+JtNBBNsY=
-----END PUBLIC KEY-----
`;

module.exports = { PUBLIC_KEY_PEM };
