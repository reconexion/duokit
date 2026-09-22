// Fecha límite de acceso ("AAAA-MM-DD" = último día válido) en un formato que la interfaz pueda mostrar.
const MS_PER_DAY = 86400000;
const WARN_DAYS = 7;

const parse = (expiresAt) => {
  const [y, m, d] = expiresAt.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// dateLocale viene de la traducción activa (es-MX / en-US): así la fecha se lee en el idioma elegido.
export const formatLong = (expiresAt, dateLocale = 'es-MX') => parse(expiresAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' });
const formatShort = (expiresAt, dateLocale = 'es-MX') => parse(expiresAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');

// Devuelve null si el usuario no tiene vencimiento. `t` es la función de traducción de src/i18n.jsx.
export function accessInfo(expiresAt, t) {
  if (!expiresAt) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((parse(expiresAt) - today) / MS_PER_DAY); // 0 = hoy es el último día
  const dateLocale = t('access.dateLocale');

  const title = t('access.expiresTitle', { date: formatLong(expiresAt, dateLocale) });
  if (daysLeft === 0) return { label: t('access.expiresToday'), tone: 'warning', title };
  if (daysLeft === 1) return { label: t('access.expiresTomorrow'), tone: 'warning', title };
  if (daysLeft <= WARN_DAYS) return { label: t('access.expiresInDays', { days: daysLeft }), tone: 'warning', title };
  return { label: t('access.accessUntil', { date: formatShort(expiresAt, dateLocale) }), tone: 'brand', title };
}
