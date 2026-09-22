// Contexto de idioma (ES/EN). El valor por defecto se detecta del idioma del navegador
// (navigator.language): no usamos geolocalización por IP a propósito, para no mandar datos
// nuevos a ningún lado ni tener que tocar el aviso de privacidad (ver src/Legal.jsx, "Cookies").
// El cambio manual se recuerda en localStorage (dato solo del navegador, no llega al servidor).
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import en from './locales/en';
import es from './locales/es';

const LOCALES = { es, en };
export const LANGS = ['es', 'en'];
const STORAGE_KEY = 'duokit_lang';

function detectLang() {
  const candidates = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.toLowerCase().startsWith('en')) return 'en';
  }
  return 'es'; // por defecto español: es el idioma en el que operamos hoy
}

function readStoredLang() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(value) ? value : null;
  } catch {
    return null; // sin almacenamiento local (modo privado, etc.): se detecta cada vez
  }
}

function getPath(obj, path) {
  return path.split('.').reduce((node, key) => (node == null ? node : node[key]), obj);
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => readStoredLang() || detectLang());

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (next) => {
    if (!LANGS.includes(next)) return;
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* sin almacenamiento local: el cambio dura solo esta visita */
    }
  };

  const t = useMemo(() => {
    return (key, vars) => {
      const raw = getPath(LOCALES[lang], key) ?? getPath(LOCALES.es, key) ?? key;
      if (typeof raw !== 'string') return raw; // arrays/objetos de traducción (listas de features, FAQ...)
      if (!vars) return raw;
      return Object.entries(vars).reduce((str, [name, value]) => str.replaceAll(`{${name}}`, value), raw);
    };
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n debe usarse dentro de <I18nProvider>.');
  return ctx;
}
