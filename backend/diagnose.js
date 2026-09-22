// Diagnóstico de "¿me bloquea YouTube en este servidor?" (GET /api/admin/ytdlp-diagnose, solo admin).
// Prueba, contra un video corto y siempre público, la configuración actual (YTDLP_PLAYER_CLIENT / YTDLP_COOKIES_FILE /
// YTDLP_EXTRA_ARGS) y, además, algunas alternativas conocidas — así se ve de un vistazo cuál hace falta sin ir
// cambiando variables de entorno y reiniciando una por una. No descarga nada: usa --simulate.
//
// Importante: NO se fija un -f explícito. Con -f "best" a secas yt-dlp puede fallar con "Requested format is not
// available" incluso sin ningún bloqueo (es un selector legado que no siempre casa con lo que devuelve el cliente por
// defecto); eso no es un bloqueo de YouTube y confundirlo con uno llevaría a pagar un proxy que no hace falta. Sin -f,
// yt-dlp elige su combinación por defecto (bestvideo+bestaudio/best), que es lo que de verdad se parece a la app real.
const { spawn } = require('child_process');
const { strategyArgs } = require('./ytdlp-strategy');

// "Me at the zoo" (2005): el primer video de YouTube, público, corto y estable como referencia.
const TEST_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const TIMEOUT_MS = 20000;

// Estas son las señales conocidas de que YouTube pidió una prueba de humano y no se pasó (ver deploy/README.md).
// Cualquier otro error (video no disponible, red, formato) NO cuenta como bloqueo, aunque yt-dlp también termine con código distinto de 0.
const BLOCK_PATTERN = /sign in to confirm|http error 403|http error 429|precondition check failed|failed to extract any player response/i;

function run(args) {
  return new Promise((resolve) => {
    const child = spawn('yt-dlp', [TEST_URL, '--simulate', '--no-warnings', ...args]);
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, blocked: false, detail: `Se agotó el tiempo (${TIMEOUT_MS / 1000}s): probablemente el servidor se quedó esperando una respuesta que no llegó.` });
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, blocked: false, detail: `No se pudo ejecutar yt-dlp: ${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const detail = output.trim().slice(-500);
      resolve({ ok: code === 0, blocked: code !== 0 && BLOCK_PATTERN.test(output), detail });
    });
  });
}

// Candidatos conocidos para el bloqueo "Sign in to confirm you're not a bot" en servidores de nube.
const CANDIDATES = [
  { label: 'Configuración actual del servidor', args: strategyArgs() },
  { label: 'Sin ningún ajuste especial (línea base)', args: [] },
  { label: '--extractor-args youtube:player_client=android', args: ['--extractor-args', 'youtube:player_client=android'] },
  { label: '--extractor-args youtube:player_client=web_embedded', args: ['--extractor-args', 'youtube:player_client=web_embedded'] },
  { label: '--extractor-args youtube:player_client=tv', args: ['--extractor-args', 'youtube:player_client=tv'] },
];

async function diagnose() {
  const results = [];
  for (const { label, args } of CANDIDATES) {
    const outcome = await run(args);
    results.push({ label, args, ...outcome });
  }
  const [current, ...rest] = results;
  const working = rest.find((r) => r.ok);
  const anyBlocked = results.some((r) => r.blocked);

  let verdict;
  if (current.ok) {
    verdict = 'La configuración actual del servidor ya funciona: no hace falta cambiar nada.';
  } else if (!anyBlocked) {
    verdict = `No parece ser un bloqueo de YouTube (el error no coincide con los que YouTube usa para pedir "confirma que no eres un bot"). Puede ser una falla puntual de red o del video de prueba: vuelve a intentarlo antes de gastar en un proxy. Detalle: ${current.detail.split('\n').pop()}`;
  } else if (working) {
    verdict = `Bloqueado con la configuración actual, pero "${working.label}" funcionó. Ponlo en YTDLP_PLAYER_CLIENT y reinicia — no hace falta pagar nada.`;
  } else {
    verdict = 'Bloqueado con todo lo probado. Toca un proxy residencial o cookies de una cuenta de YouTube (YTDLP_COOKIES_FILE). Ver deploy/README.md.';
  }
  return { testedAt: new Date().toISOString(), results, verdict };
}

module.exports = { diagnose };
