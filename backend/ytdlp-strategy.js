// En algunos hospedajes (servidores en la nube) YouTube exige una prueba de que la petición viene de un navegador real
// y bloquea a yt-dlp con "Sign in to confirm you're not a bot". Estas variables, todas opcionales, prueban las salidas
// conocidas sin tocar código; usa /api/admin/ytdlp-diagnose para ver cuál (si alguna) hace falta en tu servidor.
// Vive en su propio archivo porque tanto las descargas reales (server.js) como el diagnóstico (diagnose.js) lo usan:
// así se prueba exactamente la misma estrategia que después corre en producción, no una parecida.
function strategyArgs(env = process.env) {
  const args = [];
  // Cliente que finge ser yt-dlp ante YouTube: 'android', 'web_embedded', 'tv'... (ver --extractor-args de yt-dlp).
  if (env.YTDLP_PLAYER_CLIENT) args.push('--extractor-args', `youtube:player_client=${env.YTDLP_PLAYER_CLIENT}`);
  // Cookies de una cuenta de YouTube logueada, exportadas a un archivo (ver deploy/README.md). Nunca subas ese archivo a git.
  if (env.YTDLP_COOKIES_FILE) args.push('--cookies', env.YTDLP_COOKIES_FILE);
  // Proxy residencial de pago, cuando YouTube bloquea la IP del servidor y ningún player_client lo arregla gratis.
  // Formato que yt-dlp espera: http://usuario:contraseña@host:puerto (lo que da el proveedor, con protocolo al frente).
  if (env.YTDLP_PROXY) args.push('--proxy', env.YTDLP_PROXY);
  // Argumentos sueltos para probar algo puntual sin tocar código (se separan por espacios; no acepta comillas).
  if (env.YTDLP_EXTRA_ARGS) args.push(...env.YTDLP_EXTRA_ARGS.split(/\s+/).filter(Boolean));
  return args;
}

module.exports = { strategyArgs };
