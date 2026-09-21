import { Button } from '@/components/base/buttons/button';

const TELEGRAM_URL = import.meta.env.VITE_TELEGRAM_URL || 'https://t.me/tostilocos';
const UPDATED = '21 de septiembre de 2026';

// Los precios y límites no se repiten aquí: valen los que se muestran en "Planes" y en el bot al comprar.
const SECTIONS = [
  {
    id: 'terminos',
    title: 'Términos de uso',
    blocks: [
      {
        h: '1. El servicio',
        p: [
          'duokit es una herramienta para descargar de YouTube video, audio (MP3) y miniaturas desde tu navegador. Se contrata por Telegram y se paga por transferencia SPEI. Al pagar o usar duokit aceptas estos términos.',
        ],
      },
      {
        h: '2. Planes',
        p: [
          'Los precios, la calidad máxima y el número de descargas por día de cada plan son los que aparecen en la sección Planes y en el bot al momento de comprar.',
          'El plan Básico dura 30 días y no se renueva solo: nunca hacemos cobros automáticos. Para seguir, compras de nuevo y se suman 30 días a tu cuenta.',
          'El plan Permanente es de pago único y no vence: tu acceso dura mientras duokit siga operando. No es un plazo garantizado; si algún día dejamos de ofrecer el servicio, lo anunciaremos por Telegram.',
        ],
      },
      {
        h: '3. Tu cuenta',
        p: [
          'La cuenta es personal. No la revendas ni compartas tus datos de acceso. Se permiten hasta 2 sesiones abiertas a la vez; al abrir una tercera se cierra la más antigua.',
          'Hay límites de uso (descargas por minuto y por día, y descargas simultáneas) para que el servicio funcione bien para todos. Los archivos que descargas no se guardan en nuestro servidor: se borran solos pocos minutos después.',
          'Si superas los límites de forma repetida, automatizas el servicio o lo usas de forma abusiva, podemos suspender tu cuenta. Una suspensión por incumplir estos términos no da derecho a reembolso.',
        ],
      },
      {
        h: '4. El contenido que descargas',
        p: [
          'Eres responsable de lo que descargas y de lo que haces con ello. Descarga solo contenido tuyo o que tengas permiso de usar, y respeta los derechos de autor, la ley aplicable y las condiciones de YouTube.',
          'duokit no es de YouTube ni de Google, no está afiliado a ellos y no aloja ni distribuye contenido de terceros.',
        ],
      },
      {
        h: '5. Disponibilidad',
        p: [
          'duokit depende de YouTube, que puede cambiar en cualquier momento y dejar de funcionar total o parcialmente algún video o el servicio. Trabajamos para arreglarlo lo antes posible, pero no garantizamos disponibilidad continua ni que todos los videos se puedan descargar. El servicio se ofrece “tal cual”.',
        ],
      },
      {
        h: '6. Cambios',
        p: ['Podemos actualizar estos términos. La versión vigente es la de esta página y aplica a las compras y al uso posteriores a su fecha de actualización.'],
      },
    ],
  },
  {
    id: 'reembolsos',
    title: 'Política de reembolsos',
    blocks: [
      {
        h: 'No hay reembolsos',
        p: [
          'Todas las compras son finales. Al confirmar tu transferencia activamos tu acceso al momento, por eso no hacemos devoluciones de ningún plan (Básico ni Permanente), ni por acceso no usado, ni por cambio de opinión, ni por una suspensión por incumplir los términos.',
          'Revisa el plan y el monto antes de transferir. Si tienes un problema con tu acceso o con una descarga, escríbenos por Telegram y lo resolvemos.',
        ],
      },
    ],
  },
  {
    id: 'privacidad',
    title: 'Aviso de privacidad',
    blocks: [
      {
        h: 'Quién trata tus datos',
        p: ['duokit es responsable de tus datos personales. Contacto: @tostilocos en Telegram.'],
      },
      {
        h: 'Qué datos guardamos',
        p: [
          'Los que nos das en Telegram: tu ID, tu @usuario y tu nombre, además del nombre completo que escribes al comprar (para reconocer tu transferencia).',
          'Los de tu cuenta: usuario, plan, fecha de vencimiento y tu contraseña, que se guarda cifrada (nunca en texto claro).',
          'Los de tus pagos: referencia, plan, monto y fechas.',
          'Los de tu uso: fecha y dirección IP de tus inicios de sesión y de cada descarga, con el enlace del video y la calidad elegida. No guardamos los archivos que descargas.',
        ],
      },
      {
        h: 'Para qué los usamos',
        p: [
          'Para crear y administrar tu cuenta, confirmar tus pagos, enviarte tu acceso y tus recibos por Telegram, aplicar los límites de uso, prevenir abusos y atender tus dudas. No los usamos para publicidad.',
        ],
      },
      {
        h: 'Con quién los compartimos',
        p: [
          'No vendemos ni compartimos tus datos con terceros. Solo pasan por Telegram, que es el canal por el que nos comunicamos contigo, y los entregaremos si una autoridad competente nos lo exige.',
        ],
      },
      {
        h: 'Cookies',
        p: ['Usamos una sola cookie técnica de sesión, necesaria para que puedas entrar y se borra al cerrar el navegador. No usamos cookies de publicidad ni de analítica.'],
      },
      {
        h: 'Cuánto tiempo',
        p: [
          'El registro de tu actividad (dirección IP y enlaces de tus descargas) se borra automáticamente a los 90 días.',
          'Los demás datos los conservamos mientras tu cuenta exista y el tiempo necesario para atender aclaraciones o exigencias legales.',
        ],
      },
      {
        h: 'Tus derechos',
        p: [
          'Puedes pedir acceder a tus datos, corregirlos, cancelarlos u oponerte a su uso (derechos ARCO) escribiendo a @tostilocos. Si cancelamos tus datos, tu cuenta deja de funcionar. Si cambiamos este aviso, lo publicaremos en esta página.',
        ],
      },
    ],
  },
];

export default function Legal() {
  return (
    <div className="min-h-screen bg-primary text-primary">
      <header className="border-b border-secondary">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-brand-900">
            duokit
          </a>
          <Button size="sm" color="secondary" href="/">
            Volver al inicio
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight text-primary sm:text-5xl">Términos, reembolsos y privacidad</h1>
        <p className="mt-3 text-md text-tertiary">Última actualización: {UPDATED}</p>

        <nav aria-label="Secciones" className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
          {SECTIONS.map(({ id, title }) => (
            <a key={id} href={`#${id}`} className="text-brand-secondary hover:underline">
              {title}
            </a>
          ))}
        </nav>

        {SECTIONS.map(({ id, title, blocks }) => (
          <section key={id} id={id} className="mt-14 scroll-mt-8">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-primary sm:text-3xl">{title}</h2>
            {blocks.map(({ h, p }) => (
              <div key={h} className="mt-6 flex flex-col gap-2">
                <h3 className="text-lg font-semibold text-primary">{h}</h3>
                {p.map((text) => (
                  <p key={text} className="text-md text-tertiary">
                    {text}
                  </p>
                ))}
              </div>
            ))}
          </section>
        ))}

        <p className="mt-14 border-t border-secondary pt-6 text-sm text-tertiary">
          ¿Dudas? Escríbenos a{' '}
          <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-secondary hover:underline">
            @tostilocos
          </a>
          .
        </p>
      </main>
    </div>
  );
}
