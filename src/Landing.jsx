import { Mascot } from 'page-mascot';
import { Check, ChevronDown, CreditCard01, Download01, Globe01, Key01, Link01, MessageChatCircle, MusicNote01, Scissors01, Send01, VideoRecorder } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { FeaturedIcon } from '@/components/foundations/featured-icon/featured-icon';
import { cx } from '@/utils/cx';

const TELEGRAM_URL = import.meta.env.VITE_TELEGRAM_URL || 'https://t.me/tostilocos';

const telegramLink = { href: TELEGRAM_URL, target: '_blank', rel: 'noopener noreferrer' };

const FEATURES = [
  { icon: VideoRecorder, title: 'Video hasta 4K', text: 'Elige la calidad, desde 480p. El 4K llega con el plan Permanente.' },
  { icon: MusicNote01, title: 'Solo el audio', text: 'Guarda la canción o el podcast en MP3, de 64 a 320 kbps.' },
  { icon: Scissors01, title: 'Recorta lo que necesitas', text: 'Descarga solo un fragmento, con minuto y segundo de inicio y fin.' },
  { icon: Globe01, title: 'Elige el doblaje', text: 'Si el video tiene varios idiomas de audio, escoges cuál bajar.' },
];

const STEPS = [
  { icon: MessageChatCircle, title: 'Escríbenos en Telegram', text: 'Manda /comprar y elige tu plan.' },
  { icon: CreditCard01, title: 'Transfiere por SPEI', text: 'Te damos los datos de la cuenta, una referencia única y tu recibo en PDF.' },
  { icon: Key01, title: 'Recibe tu acceso', text: 'Al confirmar tu pago te llegan tu usuario y contraseña. Entra y descarga.' },
];

const PLANS = [
  {
    id: 'basic',
    name: 'Básico',
    price: '$129',
    unit: 'MXN al mes',
    blurb: 'Para descargar cuando lo necesitas.',
    features: ['30 días de acceso', 'Video hasta 1080p', 'Hasta 30 descargas al día', 'Audio MP3 y miniaturas', 'Recorte de fragmentos'],
  },
  {
    id: 'lifetime',
    name: 'Permanente',
    price: '$2,999',
    unit: 'MXN, pago único',
    blurb: 'Págalo una vez y olvídate de renovar.',
    highlight: true,
    features: ['Acceso de por vida', 'Video hasta 4K', 'Hasta 150 descargas al día', 'Todo lo del plan Básico', 'Sin renovaciones'],
  },
];

const FAQ = [
  { q: '¿Cómo pago?', a: 'Por transferencia SPEI. En Telegram te damos los datos de la cuenta y una referencia única; tú solo escribes esa referencia en el concepto.' },
  { q: '¿Cuánto tarda en activarse mi cuenta?', a: 'En cuanto confirmamos tu transferencia. Te llega el usuario y la contraseña por Telegram, junto con tu recibo.' },
  { q: '¿Puedo entrar desde varios dispositivos?', a: 'Sí, hasta 2 sesiones abiertas a la vez con la misma cuenta. Si abres una tercera, se cierra la más antigua.' },
  { q: '¿Hay reembolsos?', a: 'No. Todas las compras son finales porque tu acceso se activa en cuanto confirmamos la transferencia. Si tienes un problema con tu acceso o con una descarga, escríbenos por Telegram y lo resolvemos.' },
  { q: '¿Qué pasa cuando vence el plan Básico?', a: 'Tu acceso termina en la fecha indicada. Para seguir, vuelves a mandar /comprar: la renovación suma 30 días a tu cuenta.' },
];

// Vista previa de la app (solo decorativa).
function AppPreview() {
  const tiles = [
    { icon: VideoRecorder, title: 'Video', detail: 'MP4', on: true },
    { icon: MusicNote01, title: 'Audio', detail: 'MP3' },
    { icon: Download01, title: 'Miniatura', detail: 'JPG' },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none flex w-full max-w-md select-none flex-col gap-5 rounded-2xl bg-primary p-6 shadow-2xl shadow-brand-600/15 ring-1 ring-brand-200">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-secondary">Enlace del video</span>
        <div className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-md text-tertiary shadow-xs ring-1 ring-primary ring-inset">
          <Link01 className="size-5 text-fg-quaternary" />
          youtube.com/watch?v=...
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {tiles.map(({ icon, title, detail, on }) => (
          <div key={title} className={cx('flex flex-col gap-3 rounded-xl p-3 ring-1 ring-inset', on ? 'bg-brand-primary ring-2 ring-brand-solid' : 'bg-primary ring-primary')}>
            <FeaturedIcon icon={icon} theme={on ? 'dark' : 'light'} color="brand" size="md" />
            <div className="flex flex-col items-start gap-1.5">
              <span className="text-sm font-semibold text-primary">{title}</span>
              <Badge size="sm" color={on ? 'brand' : 'gray'}>
                {detail}
              </Badge>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 rounded-lg bg-brand-solid px-4 py-3 text-md font-semibold text-white">
        <Download01 className="size-5" />
        Descargar
      </div>
    </div>
  );
}

function SectionHeading({ title, text }) {
  return (
    <div className="mx-auto mb-12 flex max-w-2xl flex-col items-center gap-3 text-center">
      <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-primary sm:text-4xl">{title}</h2>
      {text && <p className="text-lg text-tertiary">{text}</p>}
    </div>
  );
}

function PlanCard({ plan }) {
  return (
    <div
      className={cx(
        'relative flex flex-col gap-6 rounded-2xl bg-primary p-8 ring-1 ring-inset',
        plan.highlight ? 'shadow-2xl shadow-brand-600/15 ring-2 ring-brand-solid' : 'shadow-xs ring-secondary',
      )}
    >
      {plan.highlight && (
        <div className="absolute -top-3 left-8">
          <Badge size="md" color="brand">
            Mejor valor
          </Badge>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold text-primary">{plan.name}</h3>
        <p className="text-md text-tertiary">{plan.blurb}</p>
      </div>
      <p className="flex items-baseline gap-2">
        <span className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight text-primary">{plan.price}</span>
        <span className="text-md text-tertiary">{plan.unit}</span>
      </p>
      <ul className="flex flex-col gap-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-center gap-3 text-md text-secondary">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-secondary text-fg-brand-primary">
              <Check className="size-3.5 stroke-[3px]" />
            </span>
            {feature}
          </li>
        ))}
      </ul>
      <Button size="xl" color={plan.highlight ? 'primary' : 'secondary'} iconLeading={Send01} className="mt-auto w-full" {...telegramLink}>
        Comprar en Telegram
      </Button>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-primary text-primary">
      {/* Barra superior */}
      <header className="sticky top-0 z-30 border-b border-secondary bg-primary/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-brand-900">
            duokit
          </a>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-tertiary md:flex" aria-label="Secciones">
            <a href="#como-funciona" className="transition hover:text-primary">Cómo funciona</a>
            <a href="#planes" className="transition hover:text-primary">Planes</a>
            <a href="#preguntas" className="transition hover:text-primary">Preguntas</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button size="sm" color="secondary" href="/app">
              Entrar
            </Button>
            <Button size="sm" color="primary" iconLeading={Send01} className="hidden sm:inline-flex" {...telegramLink}>
              Únete en Telegram
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Portada */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 -z-10 h-[520px]"
            style={{ backgroundImage: 'radial-gradient(60% 80% at 80% 0%, var(--color-brand-100), transparent 70%), radial-gradient(40% 60% at 0% 20%, var(--color-brand-50), transparent 70%)' }}
          />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-24">
            <div className="flex flex-col items-start gap-6">
              <Badge size="lg" color="brand">
                Descargador de YouTube
              </Badge>
              <h1 className="font-[family-name:var(--font-display)] text-5xl leading-[1.05] font-bold tracking-tight text-primary sm:text-6xl">
                Descarga de YouTube <span className="text-brand-secondary">sin vueltas.</span>
              </h1>
              <p className="max-w-xl text-lg text-tertiary sm:text-xl">
                Pega el enlace, elige video, audio o miniatura y tu navegador lo guarda. Sin instalar nada, sin anuncios y con recorte de fragmentos incluido.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button size="xl" color="primary" iconLeading={Send01} {...telegramLink}>
                  Únete en Telegram
                </Button>
                <Button size="xl" color="secondary" href="/app">
                  Ya tengo cuenta
                </Button>
              </div>
              <p className="text-sm text-tertiary">Pagas por transferencia (SPEI) y recibes tu acceso por Telegram.</p>
            </div>

            <div className="relative flex justify-center lg:justify-end">
              <AppPreview />
              <div className="absolute -right-2 -bottom-20 hidden sm:block lg:-right-6">
                <Mascot
                  directions="/mascots/koala-directions.webp"
                  reactions="/mascots/koala-reactions.webp"
                  size={150}
                  label="Koala mascota. Sigue tu cursor y reacciona si lo tocas."
                />
              </div>
            </div>
          </div>
        </section>

        {/* Qué incluye */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <SectionHeading title="Todo lo que necesitas para guardar un video" text="Una sola pantalla, sin configuraciones raras." />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon, title, text }) => (
              <div key={title} className="flex flex-col gap-4 rounded-2xl bg-primary p-6 shadow-xs ring-1 ring-secondary ring-inset">
                <FeaturedIcon icon={icon} theme="light" color="brand" size="lg" />
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-lg font-semibold text-primary">{title}</h3>
                  <p className="text-md text-tertiary">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Cómo funciona */}
        <section id="como-funciona" className="scroll-mt-16 bg-secondary py-16 lg:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading title="Empieza en tres pasos" text="Sin formularios ni tarjetas: todo por Telegram." />
            <ol className="grid gap-8 md:grid-cols-3">
              {STEPS.map(({ icon, title, text }, index) => (
                <li key={title} className="flex flex-col items-center gap-4 text-center">
                  <div className="relative">
                    <FeaturedIcon icon={icon} theme="modern" color="brand" size="xl" />
                    <span className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-brand-solid text-sm font-bold text-white ring-4 ring-bg-secondary">
                      {index + 1}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-primary">{title}</h3>
                  <p className="max-w-xs text-md text-tertiary">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Planes */}
        <section id="planes" className="mx-auto max-w-4xl scroll-mt-16 px-4 py-16 sm:px-6 lg:py-24">
          <SectionHeading title="Elige tu plan" text="Precios en pesos mexicanos. Sin letra chiquita." />
          <div className="grid gap-8 md:grid-cols-2">
            {PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-tertiary">
            Todas las compras son finales: no hay reembolsos. Al comprar aceptas los{' '}
            <a href="/legal#terminos" className="font-semibold text-brand-secondary hover:underline">
              términos
            </a>
            .
          </p>
        </section>

        {/* Preguntas */}
        <section id="preguntas" className="mx-auto max-w-3xl scroll-mt-16 px-4 pb-16 sm:px-6 lg:pb-24">
          <SectionHeading title="Preguntas frecuentes" />
          <div className="flex flex-col divide-y divide-[var(--color-border-secondary)] rounded-2xl ring-1 ring-secondary ring-inset">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group px-6 py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-md font-semibold text-primary">
                  {q}
                  <ChevronDown className="size-5 shrink-0 text-fg-quaternary transition group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-md text-tertiary">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Llamado final */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:pb-24">
          <div
            className="flex flex-col items-center gap-6 rounded-3xl px-6 py-14 text-center text-white"
            style={{ backgroundImage: 'radial-gradient(120% 90% at 0% 0%, rgb(255 255 255 / 0.18), transparent 60%), linear-gradient(160deg, var(--color-brand-700), var(--color-brand-900))' }}
          >
            <h2 className="max-w-xl font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">¿Listo para descargar sin vueltas?</h2>
            <p className="max-w-md text-lg text-brand-100">Escríbenos en Telegram y en un rato ya estás dentro.</p>
            <Button size="xl" color="secondary" iconLeading={Send01} {...telegramLink}>
              Únete en Telegram
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-secondary">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-tertiary sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} duokit · Contacto:{' '}
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-secondary hover:underline">
              @tostilocos
            </a>
          </p>
          <div className="flex max-w-md flex-col gap-2 sm:items-end sm:text-right">
            <p className="flex gap-4 font-semibold text-brand-secondary">
              <a href="/legal#terminos" className="hover:underline">Términos</a>
              <a href="/legal#reembolsos" className="hover:underline">Reembolsos</a>
              <a href="/legal#privacidad" className="hover:underline">Privacidad</a>
            </p>
            <p>Descarga solo contenido tuyo o que tengas permiso de usar. duokit no está afiliado a YouTube.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
