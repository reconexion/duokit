// Apartado de cuenta: usuario, nombre y un botón para generar una contraseña nueva. La contraseña nueva se muestra
// difuminada (con botón para revelarla) porque es la única vez que se ve — reemplaza al viejo "/recuperar" del bot,
// pero solo sirve estando logueado; si ya cerraste sesión en todos lados, hace falta pedirle a soporte que la reinicie.
import { useState } from 'react';
import { AlertCircle, Copy01, Eye, EyeOff, RefreshCw02 } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { apiFetch } from './api';

function MaskedPassword({ password }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin portapapeles: se puede seguir viendo y copiando a mano */
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2.5 ring-1 ring-primary ring-inset">
      <code className={`min-w-0 flex-1 truncate text-md font-semibold text-primary ${visible ? '' : 'blur-sm select-none'}`} aria-hidden={!visible}>
        {password}
      </code>
      <button type="button" onClick={() => setVisible((v) => !v)} className="shrink-0 text-fg-quaternary transition hover:text-fg-secondary" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
        {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
      <button type="button" onClick={copy} className="shrink-0 text-fg-quaternary transition hover:text-fg-secondary" aria-label="Copiar contraseña">
        <Copy01 className="size-5" />
      </button>
      {copied && <span className="shrink-0 text-xs font-semibold text-success-primary">Copiada</span>}
    </div>
  );
}

export default function AccountPanel({ user }) {
  const [password, setPassword] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const regenerate = async () => {
    if (busy) return;
    if (password && !window.confirm('Se cerrarán tus otras sesiones abiertas (no esta). ¿Generar una contraseña nueva?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/account/reset-password', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo generar la contraseña.');
      setPassword(data.password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl bg-secondary p-5 ring-1 ring-secondary ring-inset">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold tracking-wide text-tertiary uppercase">Usuario</span>
        <span className="text-md font-semibold text-primary">{user.username}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold tracking-wide text-tertiary uppercase">Nombre</span>
        <span className="text-md font-semibold text-primary">{user.name}</span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-wide text-tertiary uppercase">Contraseña</span>
        {password ? (
          <MaskedPassword password={password} />
        ) : (
          <p className="text-sm text-tertiary">Por seguridad no se muestra. Genera una nueva si la necesitas.</p>
        )}
        <Button size="sm" color="secondary" iconLeading={RefreshCw02} isLoading={busy} onPress={regenerate} className="self-start">
          Generar contraseña nueva
        </Button>
        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-error-primary">
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
