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

export function useHelper() {
  const [available, setAvailable] = useState(null); // null = comprobando; true/false después
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setAvailable(null);
    pingHelper().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { available, recheck: () => setTick((t) => t + 1) };
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
