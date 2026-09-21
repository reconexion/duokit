import { Mascot } from 'page-mascot';
import { LogOut01 } from '@untitledui/icons';
import { Avatar } from '@/components/base/avatar/avatar';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import Pattern from './Pattern';
import Downloader from './Downloader';
import Login from './Login';
import { accessInfo } from './access';
import { AuthProvider, useAuth } from './auth';

const initialsOf = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

function UserBar() {
  const { user, logout } = useAuth();
  const access = accessInfo(user.expiresAt);
  return (
    <div className="mb-8 flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2">
      {access && (
        <span title={access.title}>
          <Badge size="md" color={access.tone}>
            {access.label}
          </Badge>
        </span>
      )}
      <div className="flex items-center gap-2.5">
        <Avatar size="sm" initials={initialsOf(user.name)} alt={user.name} />
        <div className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="truncate text-sm font-semibold text-primary">{user.name}</span>
          <span className="truncate text-xs text-tertiary">{user.username}</span>
        </div>
      </div>
      <Button size="sm" color="secondary" iconLeading={LogOut01} onPress={logout}>
        Cerrar sesión
      </Button>
    </div>
  );
}

function Home() {
  const { user } = useAuth();
  const firstName = user.name.split(/\s+/)[0];
  return (
    <div className="mx-auto flex w-full max-w-[40rem] flex-col items-center animate-in fade-in slide-in-from-bottom-3 duration-500">
      <UserBar />
      <header className="mb-8 flex flex-col items-center text-center">
        <h1 className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight text-brand-900 sm:text-6xl">duokit</h1>
        <p className="mt-3 max-w-md text-md text-tertiary">
          Hola, {firstName}. Descarga videos, audio y miniaturas de YouTube: pega el enlace y elige qué guardar.
        </p>
      </header>
      <Downloader />
    </div>
  );
}

function Content() {
  const { status, user } = useAuth();
  if (status === 'loading') return <p className="mt-32 text-sm text-tertiary">Cargando...</p>;
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
  if (!user) return null;
  return (
    <div className="pointer-events-none fixed right-6 bottom-0 z-20 hidden translate-y-[14%] lg:block">
      <div className="pointer-events-auto">
        <Mascot
          directions="/mascots/koala-directions.webp"
          reactions="/mascots/koala-reactions.webp"
          size={160}
          label="Koala mascota. Sigue tu cursor y reacciona si lo tocas."
        />
      </div>
    </div>
  );
}

export default function App() {
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
