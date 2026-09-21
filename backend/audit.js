// Registro de auditoría (una línea JSON por evento en data/audit.log) y contadores de uso.
// Los contadores se reconstruyen del archivo al arrancar, así sobreviven a un reinicio.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, 'audit.log');
const DAY_MS = 86400000;

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

// El registro guarda IP y enlaces de cada descarga (datos personales): pasado este tiempo se borra.
const RETENTION_DAYS = Number(process.env.DUOKIT_AUDIT_RETENTION_DAYS) || 90;

// Borra del archivo los eventos más viejos que RETENTION_DAYS. El total histórico de descargas que se muestra en el panel
// se conserva en una sola línea "archive_marker". Devuelve cuántos eventos borró.
function purgeOld() {
  let raw;
  try {
    raw = fs.readFileSync(LOG_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  const keep = [];
  let removed = 0;
  let downloadsDropped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // línea dañada: se descarta
    }
    if (event.ts >= cutoff) {
      keep.push(line);
      continue;
    }
    removed += 1;
    if (event.type === 'download_start') downloadsDropped += 1;
    else if (event.type === 'archive_marker') downloadsDropped += event.downloads || 0;
  }
  if (removed === 0) return 0;
  if (downloadsDropped > 0) keep.unshift(JSON.stringify({ ts: Date.now(), at: new Date().toISOString(), type: 'archive_marker', downloads: downloadsDropped }));
  const tmp = `${LOG_FILE}.tmp`;
  fs.writeFileSync(tmp, keep.length ? `${keep.join('\n')}\n` : '', { mode: 0o600 });
  fs.renameSync(tmp, LOG_FILE);
  return removed;
}

purgeOld(); // antes de reconstruir los contadores

const downloads = new Map(); // userId -> [timestamps de descargas aceptadas]
const strikes = new Map(); // userId -> [{ ts, kind }] veces que chocó con un límite
let totalDownloads = 0;

function index(event) {
  if (event.type === 'download_start') {
    totalDownloads += 1;
    downloads.set(event.userId, [...(downloads.get(event.userId) || []), event.ts]);
  } else if (event.type === 'limit_exceeded') {
    strikes.set(event.userId, [...(strikes.get(event.userId) || []), { ts: event.ts, kind: event.kind }]);
  } else if (event.type === 'archive_marker') {
    totalDownloads += event.downloads || 0; // descargas ya borradas del registro
  } else if (event.type === 'user_unbanned') {
    strikes.delete(event.userId); // al desbloquear se empieza de cero: si no, el siguiente choque lo volvería a bloquear
  }
}

try {
  for (const line of fs.readFileSync(LOG_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      index(JSON.parse(line));
    } catch {
      /* línea dañada: se ignora */
    }
  }
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

function log(type, fields = {}) {
  const event = { ts: Date.now(), at: new Date().toISOString(), type, ...fields };
  fs.appendFileSync(LOG_FILE, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  index(event);
  return event;
}

const startOfToday = () => new Date().setHours(0, 0, 0, 0);
const within = (list = [], since) => list.filter((t) => t >= since);

module.exports = {
  log,
  purgeOld,
  downloadsInLastMinute: (userId) => within(downloads.get(userId), Date.now() - 60000).length,
  downloadsToday: (userId) => within(downloads.get(userId), startOfToday()).length,
  strikesLast24h: (userId) => (strikes.get(userId) || []).filter((s) => s.ts >= Date.now() - DAY_MS).length,
  lastStrikeAt: (userId, kind) => (strikes.get(userId) || []).filter((s) => s.kind === kind).at(-1)?.ts || 0,
  totalDownloads: () => totalDownloads,
  totalDownloadsToday: () => [...downloads.values()].reduce((sum, list) => sum + within(list, startOfToday()).length, 0),
};
