import { useEffect, useRef, useState } from 'react';
import { Mascot } from 'page-mascot';
import { AlertCircle, ClockRefresh, Lock01, MusicNote01, Scissors01, User01, VideoRecorder } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { FeaturedIcon } from '@/components/foundations/featured-icon/featured-icon';
import { useAuth } from './auth';

const FEATURES = [
  { icon: VideoRecorder, title: 'Video hasta 4K', detail: 'En MP4, con la calidad que elijas.' },
  { icon: MusicNote01, title: 'Solo el audio', detail: 'En MP3, de 64 a 320 kbps.' },
  { icon: Scissors01, title: 'Recorta un fragmento', detail: 'Descarga solo la parte que necesitas.' },
];

const WELCOME_MS = 1550;

const clock = (total) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

const NOTICE_STYLES = {
  error: 'bg-error-primary ring-error_subtle',
  warning: 'bg-warning-primary ring-amber-200',
  info: 'bg-brand-primary ring-brand-200',
};

function Notice({ tone, icon, children }) {
  return (
    <div role="alert" className={`flex gap-3 rounded-xl p-4 ring-1 ring-inset ${NOTICE_STYLES[tone]}`}>
      <FeaturedIcon icon={icon} color={tone === 'info' ? 'brand' : tone} theme="light" size="sm" className="shrink-0" />
      <p className="self-center text-sm text-secondary">{children}</p>
    </div>
  );
}

// Panel de marca: en escritorio muestra qué hace duokit; en móvil se reduce a una franja.
function BrandPanel() {
  return (
    <aside
      className="relative flex flex-col gap-6 overflow-hidden p-6 text-white sm:p-10 md:min-h-[600px] md:pb-44"
      style={{
        backgroundImage:
          'radial-gradient(120% 70% at 0% 0%, rgb(255 255 255 / 0.18), transparent 60%), linear-gradient(160deg, var(--color-brand-700), var(--color-brand-900))',
      }}
    >
      <span className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">duokit</span>

      <div className="flex flex-col gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-xl leading-tight font-semibold sm:text-2xl md:text-3xl">
          Descarga de YouTube sin vueltas.
        </h2>
        <p className="hidden max-w-xs text-md text-brand-100 md:block">
          Pega un enlace y guarda el video, el audio o la miniatura.
        </p>
      </div>

      <ul className="hidden flex-col gap-4 md:flex">
        {FEATURES.map(({ icon, title, detail }) => (
          <li key={title} className="flex items-center gap-3">
            <FeaturedIcon icon={icon} color="brand" theme="light" size="md" className="shrink-0" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{title}</span>
              <span className="text-sm text-brand-200">{detail}</span>
            </div>
          </li>
        ))}
      </ul>

      {/* El koala vive aquí mientras no hay sesión. */}
      <div className="absolute right-3 bottom-0 hidden translate-y-[12%] md:block">
        <Mascot
          directions="/mascots/koala-directions.webp"
          reactions="/mascots/koala-reactions.webp"
          size={170}
          label="Koala mascota. Sigue tu cursor y reacciona si lo tocas."
        />
      </div>
    </aside>
  );
}

// Cubre el formulario cuando el inicio de sesión fue correcto.
function Welcome({ name }) {
  const firstName = name.split(/\s+/)[0];
  return (
    <div role="status" aria-live="polite" className="welcome-overlay absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-primary p-6 text-center">
      <div className="relative flex size-24 items-center justify-center">
        <span className="welcome-ripple absolute inset-0 rounded-full bg-brand-500" aria-hidden="true" />
        <span className="welcome-badge relative flex size-24 items-center justify-center rounded-full bg-brand-solid shadow-lg shadow-brand-600/30">
          <svg viewBox="0 0 40 40" className="size-12" fill="none" aria-hidden="true">
            <path className="welcome-check" d="M11 21l6 6 12-13" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      <div className="welcome-text flex flex-col gap-1">
        <p className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-primary">¡Hola, {firstName}!</p>
        <p className="text-md text-tertiary">Sesión iniciada. Entrando a duokit...</p>
      </div>
    </div>
  );
}

export default function Login() {
  const { login, setSession, notice } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState('');
  const [failureTone, setFailureTone] = useState('error'); // 'warning' cuando el acceso venció
  const [lockSeconds, setLockSeconds] = useState(0);
  const [capsLock, setCapsLock] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [welcome, setWelcome] = useState(null); // usuario que acaba de entrar: activa la animación
  const passwordRef = useRef(null);

  // Cuenta regresiva cuando el servidor bloquea por demasiados intentos.
  useEffect(() => {
    if (lockSeconds <= 0) return undefined;
    const id = setInterval(() => setLockSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [lockSeconds > 0]);

  // Tras un error, devuelve el foco a la contraseña cuando el campo ya volvió a estar habilitado.
  useEffect(() => {
    if (focusTick > 0) passwordRef.current?.focus();
  }, [focusTick]);

  const locked = lockSeconds > 0;

  // Deja ver la animación de bienvenida y después abre la sesión (la app cambia a la pantalla principal).
  useEffect(() => {
    if (!welcome) return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = setTimeout(() => setSession(welcome), reduced ? 700 : WELCOME_MS);
    return () => clearTimeout(id);
  }, [welcome, setSession]);

  // Reinicia la animación aunque falle dos veces seguidas, sin volver a crear los campos.
  const shake = () => {
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (locked || isLoading) return;
    setFailure('');
    const next = {};
    if (!username.trim()) next.username = 'Escribe tu usuario.';
    if (!password) next.password = 'Escribe tu contraseña.';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      shake();
      return;
    }

    setIsLoading(true);
    try {
      setWelcome(await login({ username: username.trim(), password }));
    } catch (err) {
      setPassword('');
      setIsLoading(false);
      shake();
      if (err.retryAfter) {
        setLockSeconds(err.retryAfter);
      } else {
        setFailure(err.message);
        setFailureTone(err.code === 'access_expired' ? 'warning' : 'error');
        setFocusTick((t) => t + 1);
      }
    }
  };

  const trackCapsLock = (event) => setCapsLock(Boolean(event.getModifierState?.('CapsLock')));

  return (
    <section
      className={`grid w-full overflow-hidden rounded-3xl bg-primary shadow-2xl shadow-brand-600/15 ring-1 ring-brand-200 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] ${welcome ? 'welcome-card-out' : ''}`}
    >
      <BrandPanel />

      <div className="relative flex flex-col justify-center gap-8 p-6 sm:p-10">
        {welcome && <Welcome name={welcome.name} />}
        <header className="flex flex-col gap-4">
          <FeaturedIcon icon={Lock01} theme="modern" color="brand" size="lg" />
          <div className="flex flex-col gap-1.5">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-primary">Inicia sesión</h1>
            <p className="text-md text-tertiary">Bienvenido de vuelta. Ingresa tus datos para continuar.</p>
          </div>
        </header>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
          <div className={`flex flex-col gap-5 ${shaking ? 'animate-shake' : ''}`} onAnimationEnd={() => setShaking(false)}>
            <Input
              label="Usuario"
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              icon={User01}
              placeholder="Tu usuario"
              size="md"
              value={username}
              onChange={(v) => {
                setUsername(v);
                setErrors((prev) => ({ ...prev, username: undefined }));
              }}
              isInvalid={Boolean(errors.username)}
              hint={errors.username}
              isDisabled={isLoading}
            />
            <div onKeyDown={trackCapsLock} onKeyUp={trackCapsLock} onBlur={() => setCapsLock(false)}>
              <Input
                ref={passwordRef}
                label="Contraseña"
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Tu contraseña"
                size="md"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  setErrors((prev) => ({ ...prev, password: undefined }));
                }}
                isInvalid={Boolean(errors.password)}
                hint={errors.password || (capsLock ? 'Bloq Mayús está activado.' : undefined)}
                isDisabled={isLoading}
              />
            </div>
          </div>

          {locked && (
            <Notice tone="warning" icon={ClockRefresh}>
              Demasiados intentos. Vuelve a intentarlo en {clock(lockSeconds)}.
            </Notice>
          )}
          {!locked && failure && (
            <Notice tone={failureTone} icon={failureTone === 'warning' ? ClockRefresh : AlertCircle}>
              {failure}
            </Notice>
          )}
          {!locked && !failure && notice && (
            <Notice tone={notice.tone} icon={notice.tone === 'warning' ? ClockRefresh : AlertCircle}>
              {notice.message}
            </Notice>
          )}

          <Button type="submit" size="xl" color="primary" className="w-full" isLoading={isLoading} isDisabled={isLoading || locked} showTextWhileLoading>
            {isLoading ? 'Entrando...' : locked ? `Disponible en ${clock(lockSeconds)}` : 'Iniciar sesión'}
          </Button>
        </form>

        <p className="text-sm text-tertiary">¿No tienes cuenta? Pide acceso a quien administra duokit.</p>
      </div>
    </section>
  );
}
