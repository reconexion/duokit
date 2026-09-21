// Fecha límite de acceso ("AAAA-MM-DD" = último día válido) en un formato que la interfaz pueda mostrar.
const MS_PER_DAY = 86400000;
const WARN_DAYS = 7;

const parse = (expiresAt) => {
  const [y, m, d] = expiresAt.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const formatLong = (expiresAt) => parse(expiresAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
const formatShort = (expiresAt) => parse(expiresAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');

// Devuelve null si el usuario no tiene vencimiento.
export function accessInfo(expiresAt) {
  if (!expiresAt) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((parse(expiresAt) - today) / MS_PER_DAY); // 0 = hoy es el último día

  const title = `Tu acceso a duokit vence el ${formatLong(expiresAt)}.`;
  if (daysLeft === 0) return { label: 'Tu acceso vence hoy', tone: 'warning', title };
  if (daysLeft === 1) return { label: 'Tu acceso vence mañana', tone: 'warning', title };
  if (daysLeft <= WARN_DAYS) return { label: `Tu acceso vence en ${daysLeft} días`, tone: 'warning', title };
  return { label: `Acceso hasta el ${formatShort(expiresAt)}`, tone: 'brand', title };
}
