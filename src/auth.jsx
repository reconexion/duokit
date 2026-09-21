import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { UNAUTHORIZED_EVENT } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready'
  const [user, setUser] = useState(null);
  const [notice, setNotice] = useState(null); // { message, tone } que se muestra en el login

  // Al abrir la app, pregunta si ya hay una sesión activa.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (res.ok) return data;
        if (data?.code === 'access_expired' && !cancelled) setNotice({ message: data.error, tone: 'warning' });
        return null;
      })
      .then((data) => !cancelled && setUser(data?.user ?? null))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setStatus('ready'));
    return () => {
      cancelled = true;
    };
  }, []);

  // Si en cualquier momento el servidor dice 401, la sesión terminó.
  useEffect(() => {
    const onUnauthorized = (event) => {
      const detail = event.detail || {};
      setUser((current) => {
        if (current) {
          setNotice(
            detail.code === 'access_expired'
              ? { message: detail.error, tone: 'warning' }
              : { message: 'Tu sesión terminó. Inicia sesión de nuevo para continuar.', tone: 'info' },
          );
        }
        return null;
      });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async ({ username, password }) => {
    let res;
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      throw new Error('No pude conectar con el servidor. Revisa que esté encendido.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'No se pudo iniciar sesión.');
      err.retryAfter = data.retryAfter; // segundos de bloqueo (429)
      err.code = data.code; // p. ej. 'access_expired'
      throw err;
    }
    return data.user; // la app abre la sesión con setSession() cuando termina la animación
  }, []);

  const setSession = useCallback((nextUser) => {
    setNotice(null);
    setUser(nextUser);
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {});
    setNotice(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ status, user, notice, login, setSession, logout }), [status, user, notice, login, setSession, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return ctx;
}
