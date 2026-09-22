import { useState } from 'react';
import { Mascot } from 'page-mascot';
import { AlertCircle, Check, ChevronDown, CreditCard01, CursorClick01, Download01, Globe01, Key01, Link01, MusicNote01, Scissors01, VideoRecorder } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { FeaturedIcon } from '@/components/foundations/featured-icon/featured-icon';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { cx } from '@/utils/cx';
import { useI18n } from './i18n';

const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL || 'https://t.me/tostilocos';

const FEATURE_ICONS = [VideoRecorder, MusicNote01, Scissors01, Globe01];
const STEP_ICONS = [CursorClick01, CreditCard01, Key01];

// Vista previa de la app (solo decorativa).
function AppPreview() {
  const { t } = useI18n();
  const tiles = [
    { icon: VideoRecorder, title: t('hero.previewVideo'), detail: 'MP4', on: true },
    { icon: MusicNote01, title: t('hero.previewAudio'), detail: 'MP3' },
    { icon: Download01, title: t('hero.previewThumbnail'), detail: 'JPG' },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none flex w-full max-w-md select-none flex-col gap-5 rounded-2xl bg-primary p-6 shadow-2xl shadow-brand-600/15 ring-1 ring-brand-200">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-secondary">{t('hero.previewLinkLabel')}</span>
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
        {t('hero.previewDownload')}
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

function PlanCard({ plan, canBuy, isLoading, onBuy }) {
  const { t } = useI18n();
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
            {t('plans.bestValue')}
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
      <Button
        size="xl"
        color={plan.highlight ? 'primary' : 'secondary'}
        iconLeading={CreditCard01}
        className="mt-auto w-full"
        isDisabled={!canBuy || isLoading}
        isLoading={isLoading}
        onPress={onBuy}
      >
        {t('plans.buyPlan', { name: plan.name })}
      </Button>
    </div>
  );
}

export default function Landing() {
  const { t } = useI18n();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [error, setError] = useState(null);

  const features = t('features.items');
  const steps = t('steps.items');
  const faq = t('faq.items');
  const basicPlan = t('plans.basic');
  const lifetimePlan = t('plans.lifetime');
  const plans = [
    { id: 'basic', price: '$129', ...basicPlan },
    { id: 'lifetime', price: '$2,999', highlight: true, ...lifetimePlan },
  ];

  const buy = async (planId) => {
    setError(null);
    setLoadingPlan(planId);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, acceptedTerms: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('plans.checkoutError'));
      window.location.href = data.url; // a partir de aquí, Mercado Pago: pide correo, nombre y tarjeta
    } catch (err) {
      setError(err.message);
      setLoadingPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-primary text-primary">
      {/* Barra superior */}
      <header className="sticky top-0 z-30 border-b border-secondary bg-primary/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-brand-900">
            duokit
          </a>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-tertiary md:flex" aria-label={t('legal.sectionsLabel')}>
            <a href="#como-funciona" className="transition hover:text-primary">{t('nav.howItWorks')}</a>
            <a href="#planes" className="transition hover:text-primary">{t('nav.plans')}</a>
            <a href="#preguntas" className="transition hover:text-primary">{t('nav.faq')}</a>
          </nav>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button size="sm" color="secondary" href="/app">
              {t('nav.login')}
            </Button>
            <Button size="sm" color="primary" iconLeading={CreditCard01} className="hidden sm:inline-flex" href="#planes">
              {t('nav.buy')}
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
                {t('hero.badge')}
              </Badge>
              <h1 className="font-[family-name:var(--font-display)] text-5xl leading-[1.05] font-bold tracking-tight text-primary sm:text-6xl">
                {t('hero.titlePre')}<span className="text-brand-secondary">{t('hero.titleHighlight')}</span>
              </h1>
              <p className="max-w-xl text-lg text-tertiary sm:text-xl">{t('hero.subtitle')}</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button size="xl" color="primary" iconLeading={CreditCard01} href="#planes">
                  {t('hero.buy')}
                </Button>
                <Button size="xl" color="secondary" href="/app">
                  {t('hero.haveAccount')}
                </Button>
              </div>
              <p className="text-sm text-tertiary">{t('hero.payNote')}</p>
            </div>

            <div className="relative flex justify-center lg:justify-end">
              <AppPreview />
              <div className="absolute -right-2 -bottom-20 hidden sm:block lg:-right-6">
                <Mascot
                  directions="/mascots/koala-directions.webp"
                  reactions="/mascots/koala-reactions.webp"
                  size={150}
                  label={t('hero.mascotLabel')}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Qué incluye */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <SectionHeading title={t('features.heading')} text={t('features.subheading')} />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ title, text }, index) => (
              <div key={title} className="flex flex-col gap-4 rounded-2xl bg-primary p-6 shadow-xs ring-1 ring-secondary ring-inset">
                <FeaturedIcon icon={FEATURE_ICONS[index]} theme="light" color="brand" size="lg" />
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
            <SectionHeading title={t('steps.heading')} text={t('steps.subheading')} />
            <ol className="grid gap-8 md:grid-cols-3">
              {steps.map(({ title, text }, index) => (
                <li key={title} className="flex flex-col items-center gap-4 text-center">
                  <div className="relative">
                    <FeaturedIcon icon={STEP_ICONS[index]} theme="modern" color="brand" size="xl" />
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
          <SectionHeading title={t('plans.heading')} text={t('plans.subheading')} />

          <label className="mx-auto mb-8 flex max-w-lg cursor-pointer items-start gap-3 rounded-xl bg-secondary p-4 text-sm text-secondary ring-1 ring-secondary ring-inset">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-solid)]"
            />
            <span>
              {t('plans.termsPrefix')}
              <a href="/legal#terminos" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-secondary hover:underline">
                {t('plans.termsLink')}
              </a>
              {t('plans.termsMiddle')}
              <a href="/legal#reembolsos" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-secondary hover:underline">
                {t('plans.refundsLink')}
              </a>
              {t('plans.termsSuffix')}
            </span>
          </label>

          <div className="grid gap-8 md:grid-cols-2">
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} canBuy={acceptedTerms} isLoading={loadingPlan === plan.id} onBuy={() => buy(plan.id)} />
            ))}
          </div>

          {error && (
            <div role="alert" className="mx-auto mt-6 flex max-w-lg items-start gap-2 rounded-xl bg-error-primary p-4 text-sm text-error-primary ring-1 ring-error_subtle ring-inset">
              <AlertCircle className="size-5 shrink-0" />
              {error}
            </div>
          )}
        </section>

        {/* Preguntas */}
        <section id="preguntas" className="mx-auto max-w-3xl scroll-mt-16 px-4 pb-16 sm:px-6 lg:pb-24">
          <SectionHeading title={t('faq.heading')} />
          <div className="flex flex-col divide-y divide-[var(--color-border-secondary)] rounded-2xl ring-1 ring-secondary ring-inset">
            {faq.map(({ q, a }) => (
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
            <h2 className="max-w-xl font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">{t('finalCta.heading')}</h2>
            <p className="max-w-md text-lg text-brand-100">{t('finalCta.subheading')}</p>
            <Button size="xl" color="secondary" iconLeading={CreditCard01} href="#planes">
              {t('finalCta.buy')}
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-secondary">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-tertiary sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} duokit · {t('footer.contact')}:{' '}
            <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-secondary hover:underline">
              @tostilocos
            </a>
          </p>
          <div className="flex max-w-md flex-col gap-2 sm:items-end sm:text-right">
            <p className="flex gap-4 font-semibold text-brand-secondary">
              <a href="/legal#terminos" className="hover:underline">{t('footer.terms')}</a>
              <a href="/legal#reembolsos" className="hover:underline">{t('footer.refunds')}</a>
              <a href="/legal#privacidad" className="hover:underline">{t('footer.privacy')}</a>
            </p>
            <p>{t('footer.disclaimer')}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
