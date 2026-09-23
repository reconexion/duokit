// ¿El Asistente de escritorio (helper/) está corriendo en esta compu? Se pregunta con un timeout corto: si no
// contesta rápido, se asume que no está instalado/abierto — no tiene sentido esperar mucho a algo que, si existe,
// vive en la misma compu del usuario y debería contestar casi al instante.
import { useEffect, useState } from 'react';

export const HELPER_URL = 'http://127.0.0.1:47811';
const PING_TIMEOUT_MS = 900;

async function pingHelper() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    const res = await fetch(`${HELPER_URL}/ping`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// Cada cuánto se vuelve a preguntar solo, mientras no se haya detectado el Asistente — así, si el cliente lo
// instala y lo abre sin darle "verificar de nuevo", el sitio lo agarra solo en unos segundos, sin que tenga que
// acordarse de ese botón (el botón sigue ahí para revisar al toque, sin esperar el siguiente ciclo).
const AUTO_RECHECK_MS = 3000;

// En un celular no hay ningún Asistente que instalar (no existe una versión para Android/iOS) — antes esto no se
// distinguía y detectOS() caía en 'mac' (un iPhone trae "like Mac OS X" en su user-agent) o en 'linux' (Android
// trae "Linux"), ofreciendo un botón para descargar un .exe/.zip que el teléfono jamás va a poder abrir: se veía
// como un enlace roto y, además, el sitio se quedaba preguntando solo cada 3 segundos si algo contesta en
// 127.0.0.1 para siempre, sin sentido en un celular.
export function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
}

export function useHelper() {
  const [available, setAvailable] = useState(null); // null = comprobando; true/false después
  const [tick, setTick] = useState(0);
  const mobile = isMobile();

  useEffect(() => {
    if (mobile) {
      setAvailable(false);
      return undefined;
    }
    let cancelled = false;
    let timer;
    const check = () => {
      pingHelper().then((ok) => {
        if (cancelled) return;
        setAvailable(ok);
        if (!ok) timer = setTimeout(check, AUTO_RECHECK_MS);
      });
    };
    setAvailable(null);
    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tick, mobile]);

  return { available, recheck: () => setTick((t) => t + 1), isMobile: mobile };
}

// 'mac' es su propio caso: el instalador existe (se generó), pero sin firma de Apple macOS lo mata solo al
// abrirlo — así que en vez de ofrecer una descarga que se ve rota, se avisa "próximamente" (ver Downloader.jsx).
export function detectOS() {
  const ua = navigator.userAgent || '';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Win/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return 'windows';
}
