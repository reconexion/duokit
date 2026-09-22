// A esta página vuelve el cliente después de pagar (o cancelar) en Stripe. La cuenta se crea por el webhook de
// Stripe (casi siempre en un par de segundos): esta pantalla pregunta cada tanto si ya está lista y, en cuanto lo
// está, muestra el usuario y la contraseña — la contraseña empieza difuminada, con un botón para revelarla.
// Es la ÚNICA vez que se muestra: si se pierde, hay que generar una nueva ya con la sesión iniciada, o escribir a soporte.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Copy01, Download01, Eye, EyeOff, XCircle } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { FeaturedIcon } from '@/components/foundations/featured-icon/featured-icon';
import { useI18n } from './i18n';

const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL || 'https://t.me/tostilocos';
const POLL_MS = 1500;
const TIMEOUT_MS = 45000;

function MaskedPassword({ password }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* portapapeles no disponible: no pasa nada, sigue pudiendo verla y copiarla a mano */
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2.5 ring-1 ring-primary ring-inset">
      <code className={`min-w-0 flex-1 truncate text-md font-semibold text-primary ${visible ? '' : 'blur-sm select-none'}`} aria-hidden={!visible}>
        {password}
      </code>
      <span className="sr-only" aria-live="polite">
        {visible ? t('payment.visibleSr', { password }) : t('payment.hiddenSr')}
      </span>
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="shrink-0 text-fg-quaternary transition hover:text-fg-secondary"
        aria-label={visible ? t('payment.hide') : t('payment.show')}
      >
        {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
      <button type="button" onClick={copy} className="shrink-0 text-fg-quaternary transition hover:text-fg-secondary" aria-label={t('payment.copy')}>
        <Copy01 className="size-5" />
      </button>
      {copied && <span className="shrink-0 text-xs font-semibold text-success-primary">{t('payment.copied')}</span>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex flex-col gap-1 text-left">
      <span className="text-xs font-semibold tracking-wide text-tertiary uppercase">{label}</span>
      <span className="text-md font-semibold text-primary">{value}</span>
    </div>
  );
}

function SuccessCard() {
  const { t } = useI18n();
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  const [account, setAccount] = useState(null); // { ready, username, name, created, password, accessUntil }
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (!sessionId) {
      setTimedOut(true);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/checkout-status/${encodeURIComponent(sessionId)}`, { credentials: 'same-origin' });
        const data = await res.json();
        if (cancelled) return;
        if (data.ready) return setAccount(data);
      } catch {
        /* reintenta solo */
      }
      if (Date.now() - startedAt.current > TIMEOUT_MS) return setTimedOut(true);
      if (!cancelled) setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!account) {
    return (
      <>
        <FeaturedIcon icon={CheckCircle} color="success" theme="light" size="xl" />
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-primary">{t('payment.received')}</h1>
        {timedOut ? (
          <p className="text-md text-tertiary">
            {t('payment.timeoutPrefix')}
            <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-secondary hover:underline">
              {t('payment.supportLink')}
            </a>
            {t('payment.timeoutSuffix')}
          </p>
        ) : (
          <p className="text-md text-tertiary" role="status" aria-live="polite">
            {t('payment.preparing')}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <FeaturedIcon icon={CheckCircle} color="success" theme="light" size="xl" />
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-primary">
        {account.created ? t('payment.createdTitle') : t('payment.renewedTitle')}
      </h1>
      <p className="text-md text-tertiary">{account.created ? t('payment.createdText') : t('payment.renewedText')}</p>
      <div className="flex w-full flex-col gap-4 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
        <Row label={t('payment.username')} value={account.username} />
        {account.created && (
          <div className="flex flex-col gap-1 text-left">
            <span className="text-xs font-semibold tracking-wide text-tertiary uppercase">{t('payment.password')}</span>
            <MaskedPassword password={account.password} />
          </div>
        )}
      </div>
      <div className="flex w-full flex-col gap-2 sm:flex-row">
        <Button size="lg" color="primary" className="flex-1" href="/app">
          {t('payment.enter')}
        </Button>
        {sessionId && (
          <Button size="lg" color="secondary" iconLeading={Download01} href={`/api/receipt/${encodeURIComponent(sessionId)}`}>
            {t('payment.receipt')}
          </Button>
        )}
      </div>
    </>
  );
}

function CancelledCard() {
  const { t } = useI18n();
  return (
    <>
      <FeaturedIcon icon={XCircle} color="gray" theme="light" size="xl" />
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-primary">{t('payment.cancelledTitle')}</h1>
      <p className="text-md text-tertiary">{t('payment.cancelledText')}</p>
      <Button size="lg" color="primary" href="/#planes">
        {t('payment.viewPlans')}
      </Button>
    </>
  );
}

export default function PaymentReturn() {
  const exito = new URLSearchParams(window.location.search).get('estado') === 'exito';
  return (
    <div className="flex min-h-screen items-center justify-center bg-primary px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl bg-primary p-8 text-center shadow-xl shadow-brand-600/10 ring-1 ring-secondary">
        {exito ? <SuccessCard /> : <CancelledCard />}
      </div>
    </div>
  );
}
