import { useState } from 'react';
import { Mascot } from 'page-mascot';
import { LogOut01, User01 } from '@untitledui/icons';
import { Avatar } from '@/components/base/avatar/avatar';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import AccountPanel from './AccountPanel';
import Admin from './Admin';
import Landing from './Landing';
import Legal from './Legal';
import PaymentReturn from './PaymentReturn';
import Pattern from './Pattern';
import Downloader from './Downloader';
import Login from './Login';
import { accessInfo } from './access';
import { AuthProvider, useAuth } from './auth';
import { useI18n } from './i18n';
import { currentRoute } from './route';

const initialsOf = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

function UserBar({ showAccount, onToggleAccount }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  // Sin fecha de vencimiento (plan Permanente o administrador) se muestra "Acceso permanente".
  const access = user.expiresAt
    ? accessInfo(user.expiresAt, t)
    : { label: user.role === 'admin' ? t('app.admin') : t('app.lifetimeAccess'), tone: 'brand', title: t('app.lifetimeTitle') };
  return (
    <div className="mb-8 flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2">
      <LanguageSwitcher className="mr-auto" />
      <span title={access.title}>
        <Badge size="md" color={access.tone}>
          {access.label}
        </Badge>
      </span>
      <button
        type="button"
        onClick={onToggleAccount}
        aria-expanded={showAccount}
        className="flex items-center gap-2.5 rounded-lg p-1 -m-1 transition hover:bg-secondary"
      >
        <Avatar size="sm" initials={initialsOf(user.name)} alt={user.name} />
        <div className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
          <span className="truncate text-sm font-semibold text-primary">{user.name}</span>
          <span className="truncate text-xs text-tertiary">{user.username}</span>
        </div>
      </button>
      {user.role === 'admin' && (
        <Button size="sm" color="tertiary" href="/admin">
          {t('app.panel')}
        </Button>
      )}
      <Button size="sm" color="secondary" iconLeading={User01} onPress={onToggleAccount}>
        {t('app.myAccount')}
      </Button>
      <Button size="sm" color="secondary" iconLeading={LogOut01} onPress={logout}>
        {t('app.logout')}
      </Button>
    </div>
  );
}

function Home() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [showAccount, setShowAccount] = useState(false);
  const firstName = user.name.split(/\s+/)[0];
  return (
    <div className="mx-auto flex w-full max-w-[40rem] flex-col items-center animate-in fade-in slide-in-from-bottom-3 duration-500">
      <UserBar showAccount={showAccount} onToggleAccount={() => setShowAccount((v) => !v)} />
      {showAccount && (
        <div className="mb-8 w-full">
          <AccountPanel user={user} />
        </div>
      )}
      <header className="mb-8 flex flex-col items-center text-center">
        <h1 className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight text-brand-900 sm:text-6xl">duokit</h1>
        <p className="mt-3 max-w-md text-md text-tertiary">{t('app.greeting', { name: firstName })}</p>
      </header>
      <Downloader />
    </div>
  );
}

function Content() {
  const { status, user } = useAuth();
  const { t } = useI18n();
  if (status === 'loading') return <p className="mt-32 text-sm text-tertiary">{t('common.loading')}</p>;
  if (!user) {
    return (
      <div className="my-auto w-full max-w-4xl py-6">
        <Login />
      </div>
    );
  }
  return <Home />;
}

// Con sesión iniciada el koala asoma desde la esquina (solo cuando hay espacio a los lados de la tarjeta).
function CornerMascot() {
  const { user } = useAuth();
  const { t } = useI18n();
  if (!user) return null;
  return (
    <div className="pointer-events-none fixed right-6 bottom-0 z-20 hidden translate-y-[14%] lg:block">
      <div className="pointer-events-auto">
        <Mascot
          directions="/mascots/koala-directions.webp"
          reactions="/mascots/koala-reactions.webp"
          size={160}
          label={t('app.mascotLabel')}
        />
      </div>
    </div>
  );
}

function AppPage() {
  return (
    <AuthProvider>
      <Pattern />
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col items-center px-4 pt-6 pb-16 sm:pt-8">
        <Content />
      </main>
      <CornerMascot />
    </AuthProvider>
  );
}

export default function App() {
  const route = currentRoute();
  if (route === 'admin') {
    return (
      <AuthProvider>
        <Admin />
      </AuthProvider>
    );
  }
  if (route === 'app') return <AppPage />;
  if (route === 'legal') return <Legal />;
  if (route === 'pago') return <PaymentReturn />;
  return <Landing />;
}
