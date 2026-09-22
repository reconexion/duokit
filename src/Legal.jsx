import { Button } from '@/components/base/buttons/button';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n } from './i18n';

const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL || 'https://t.me/tostilocos';

// Los precios y límites no se repiten aquí: valen los que se muestran en "Planes" y al comprar.
// El contenido legal (términos, reembolsos, aviso de privacidad) vive en src/locales/es.js y en.js
// bajo la clave "legal": el inglés es una traducción directa del español, que sigue siendo el texto
// legal de referencia (así lo pidió el dueño; no se revisó por un abogado en ningún idioma).
export default function Legal() {
  const { t } = useI18n();
  const sections = t('legal.sections');
  return (
    <div className="min-h-screen bg-primary text-primary">
      <header className="border-b border-secondary">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-brand-900">
            duokit
          </a>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button size="sm" color="secondary" href="/">
              {t('legal.backHome')}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight text-primary sm:text-5xl">{t('legal.title')}</h1>
        <p className="mt-3 text-md text-tertiary">{t('legal.updated', { date: t('legal.updatedDate') })}</p>

        <nav aria-label={t('legal.sectionsLabel')} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
          {sections.map(({ id, title }) => (
            <a key={id} href={`#${id}`} className="text-brand-secondary hover:underline">
              {title}
            </a>
          ))}
        </nav>

        {sections.map(({ id, title, blocks }) => (
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
          {t('legal.questionsPrefix')}
          <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-secondary hover:underline">
            @tostilocos
          </a>
          .
        </p>
      </main>
    </div>
  );
}
