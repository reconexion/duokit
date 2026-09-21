// Planes, precios y límites de uso. Todo lo que cambia el negocio vive aquí.
const PLANS = {
  basic: {
    id: 'basic',
    name: 'Básico',
    price: 129, // MXN
    days: 30, // null = de por vida
    periodLabel: '30 días',
    maxHeight: 1080,
    qualityLabel: '1080p',
    dailyLimit: 30,
  },
  lifetime: {
    id: 'lifetime',
    name: 'Permanente',
    price: 2999,
    days: null,
    periodLabel: 'Permanente (de por vida)',
    maxHeight: 2160,
    qualityLabel: '4K',
    dailyLimit: 150,
  },
};

// Protecciones anti-abuso.
const LIMITS = {
  perMinute: 5, // descargas por minuto y usuario
  maxSessions: 2, // sesiones abiertas a la vez por cuenta
  adminMaxSessions: 5,
  strikesToBan: 5, // veces que se topa con un límite en 24 h antes del bloqueo automático
  // Protección del servidor: una descarga no puede durar ni pesar sin límite, ni acaparar todo el equipo.
  maxConcurrentJobs: 4, // descargas corriendo a la vez en todo el servidor
  maxJobsPerUser: 2, // descargas corriendo a la vez por usuario
  jobTimeoutMs: Number(process.env.DUOKIT_JOB_TIMEOUT_MS) || 20 * 60 * 1000, // pasado este tiempo la descarga se cancela
  maxFileSize: '2G', // yt-dlp no baja archivos más grandes
  maxDurationMin: Number(process.env.DUOKIT_MAX_DURATION_MIN) || 180, // no se baja un video entero más largo (con recorte por tiempo sí)
};

const money = (amount) => `$${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;

// El plan que aplica a un usuario. Los usuarios anteriores a los planes se tratan como Básico.
function planOf(user) {
  if (user.role === 'admin') return { ...PLANS.lifetime, id: 'admin', name: 'Administrador', dailyLimit: Infinity };
  return PLANS[user.plan] || PLANS.basic;
}

module.exports = { PLANS, LIMITS, money, planOf };
