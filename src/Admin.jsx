import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart01, CheckCircle, Clock, CurrencyDollarCircle, LogOut01, RefreshCw01, SearchLg, Users01 } from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { FeaturedIcon } from '@/components/foundations/featured-icon/featured-icon';
import { apiFetch } from './api';
import { useAuth } from './auth';
import { formatDateTime, formatDay, formatMoney } from './format';
import Login from './Login';

const REFRESH_MS = 15000;
const PLAN_NAMES = { basic: 'Básico', lifetime: 'Permanente' };

async function adminRequest(path, options) {
  const res = await apiFetch(`/api/admin${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo completar la acción.');
  return data;
}

function StatCard({ icon, label, value, note }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-primary p-5 shadow-xs ring-1 ring-secondary ring-inset">
      <div className="flex items-center gap-3">
        <FeaturedIcon icon={icon} theme="light" color="brand" size="md" />
        <span className="text-sm font-medium text-tertiary">{label}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-primary">{value}</span>
        <span className="text-sm text-tertiary">{note}</span>
      </div>
    </div>
  );
}

function Panel({ title, action, children }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl bg-primary shadow-xs ring-1 ring-secondary ring-inset">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-secondary px-5 py-4">
        <h2 className="text-lg font-semibold text-primary">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const Th = ({ children, className = '' }) => <th className={`px-5 py-3 text-left text-xs font-semibold whitespace-nowrap text-tertiary ${className}`}>{children}</th>;
const Td = ({ children, className = '' }) => <td className={`px-5 py-3.5 text-sm whitespace-nowrap text-secondary ${className}`}>{children}</td>;

function Empty({ text }) {
  return <p className="px-5 py-10 text-center text-sm text-tertiary">{text}</p>;
}

function Person({ name, sub }) {
  return (
    <div className="flex flex-col">
      <span className="font-medium text-primary">{name || '—'}</span>
      {sub && <span className="text-xs text-tertiary">{sub}</span>}
    </div>
  );
}

const userState = (u) => (u.status === 'banned' ? { label: 'Bloqueado', color: 'error' } : u.expired ? { label: 'Vencido', color: 'warning' } : { label: 'Activo', color: 'success' });

function Dashboard() {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null); // { tone, text, credentials? }
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await adminRequest('/summary'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const run = async (key, task) => {
    setBusy(key);
    setNotice(null);
    try {
      await task();
    } catch (err) {
      setNotice({ tone: 'error', text: err.message });
    } finally {
      setBusy('');
      load();
    }
  };

  const confirmPayment = (p) => {
    if (!window.confirm(`¿Confirmar ${p.reference} por ${formatMoney(p.amount)}?\n\nSe activará la cuenta y se le avisará al cliente por Telegram.`)) return;
    run(p.reference, async () => {
      const r = await adminRequest(`/payments/${p.reference}/confirm`, { method: 'POST', body: '{}' });
      setNotice({
        tone: r.delivered ? 'success' : 'warning',
        text: r.delivered
          ? `${r.reference} confirmado. ${r.created ? `Se creó el usuario ${r.username}` : `Se actualizó el acceso de ${r.username}`} y el cliente ya recibió sus datos por Telegram.`
          : `${r.reference} confirmado, pero no pude escribirle al cliente por Telegram. Dale sus datos por otro medio.`,
        credentials: r.credentials,
      });
    });
  };

  const cancelPayment = (p) => {
    if (!window.confirm(`¿Cancelar la referencia ${p.reference}? El cliente tendrá que pedir otra.`)) return;
    run(p.reference, async () => {
      await adminRequest(`/payments/${p.reference}/cancel`, { method: 'POST', body: '{}' });
      setNotice({ tone: 'success', text: `${p.reference} cancelado.` });
    });
  };

  const toggleBan = (u) => {
    const banning = u.status !== 'banned';
    if (!window.confirm(banning ? `¿Bloquear a ${u.username}? Perderá el acceso y se cerrarán sus sesiones.` : `¿Desbloquear a ${u.username}?`)) return;
    run(u.id, async () => {
      await adminRequest(`/users/${u.id}/${banning ? 'ban' : 'unban'}`, { method: 'POST', body: '{}' });
      setNotice({ tone: 'success', text: banning ? `${u.username} bloqueado.` : `${u.username} desbloqueado.` });
    });
  };

  const users = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!data) return [];
    return data.users.filter((u) => !q || [u.username, u.name, u.telegramUsername].some((v) => v?.toLowerCase().includes(q)));
  }, [data, query]);

  const stats = data?.stats;

  return (
    <div className="min-h-screen bg-secondary">
      <header className="border-b border-secondary bg-primary">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <a href="/" className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-brand-900">
              duokit
            </a>
            <Badge size="md" color="brand">
              Administración
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm font-medium text-secondary sm:inline">{user.name}</span>
            <Button size="sm" color="tertiary" href="/app" className="hidden sm:inline-flex">
              Ir a la app
            </Button>
            <Button size="sm" color="secondary" iconLeading={LogOut01} onPress={logout}>
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        {error && (
          <div role="alert" className="flex items-center gap-3 rounded-xl bg-error-primary p-4 text-sm text-error-primary ring-1 ring-error_subtle ring-inset">
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        {notice && (
          <div
            role="status"
            className={`flex flex-col gap-3 rounded-xl p-4 ring-1 ring-inset ${notice.tone === 'error' ? 'bg-error-primary ring-error_subtle' : notice.tone === 'warning' ? 'bg-warning-primary ring-amber-200' : 'bg-success-primary ring-green-200'}`}
          >
            <div className="flex items-start gap-3">
              <FeaturedIcon icon={notice.tone === 'error' ? AlertCircle : notice.tone === 'warning' ? Clock : CheckCircle} color={notice.tone === 'error' ? 'error' : notice.tone === 'warning' ? 'warning' : 'success'} theme="light" size="sm" className="shrink-0" />
              <p className="self-center text-sm text-secondary">{notice.text}</p>
            </div>
            {notice.credentials && (
              <p className="rounded-lg bg-primary px-4 py-3 font-mono text-sm text-primary ring-1 ring-secondary ring-inset select-all">
                Usuario: {notice.credentials.username} · Contraseña: {notice.credentials.password}
              </p>
            )}
          </div>
        )}

        {/* Cifras */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={CurrencyDollarCircle} label="Ingresos totales" value={stats ? formatMoney(stats.revenue) : '—'} note={stats ? `${stats.paidCount} pago${stats.paidCount === 1 ? '' : 's'} confirmado${stats.paidCount === 1 ? '' : 's'}` : ' '} />
          <StatCard icon={Users01} label="Usuarios activos" value={stats ? stats.activeUsers : '—'} note={stats ? `${stats.bannedUsers} bloqueado${stats.bannedUsers === 1 ? '' : 's'}` : ' '} />
          <StatCard icon={BarChart01} label="Descargas totales" value={stats ? stats.downloadsTotal.toLocaleString('es-MX') : '—'} note={stats ? `${stats.downloadsToday.toLocaleString('es-MX')} hoy` : ' '} />
          <StatCard icon={Clock} label="Pagos pendientes" value={stats ? stats.pendingCount : '—'} note="Esperando tu confirmación" />
        </div>

        {/* Pagos pendientes */}
        <Panel
          title="Pagos pendientes"
          action={
            <Button size="sm" color="tertiary" iconLeading={RefreshCw01} onPress={load}>
              Actualizar
            </Button>
          }
        >
          {!data ? (
            <Empty text="Cargando..." />
          ) : data.pending.length === 0 ? (
            <Empty text="No hay pagos pendientes." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary">
                  <tr>
                    <Th>Referencia</Th>
                    <Th>Cliente</Th>
                    <Th>Plan</Th>
                    <Th>Monto</Th>
                    <Th>Creado</Th>
                    <Th>Estado</Th>
                    <Th className="text-right">Acciones</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {data.pending.map((p) => (
                    <tr key={p.reference}>
                      <Td className="font-mono font-semibold text-primary">{p.reference}</Td>
                      <Td>
                        <Person name={p.payerName || p.telegramName} sub={p.telegramUsername ? `@${p.telegramUsername}` : p.telegramName} />
                      </Td>
                      <Td>{PLAN_NAMES[p.plan]}</Td>
                      <Td className="font-semibold text-primary">{formatMoney(p.amount)}</Td>
                      <Td>{formatDateTime(p.createdAt)}</Td>
                      <Td>
                        <Badge size="md" color={p.reportedAt ? 'brand' : 'gray'}>
                          {p.reportedAt ? 'Dice que ya pagó' : 'Esperando pago'}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" color="primary" isLoading={busy === p.reference} isDisabled={Boolean(busy)} onPress={() => confirmPayment(p)}>
                            Confirmar
                          </Button>
                          <Button size="sm" color="tertiary" isDisabled={Boolean(busy)} onPress={() => cancelPayment(p)}>
                            Cancelar
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* Usuarios */}
        <Panel
          title={`Usuarios${data ? ` (${data.users.length})` : ''}`}
          action={
            <div className="w-full sm:w-72">
              <Input aria-label="Buscar usuario" size="sm" icon={SearchLg} placeholder="Buscar por usuario, nombre o Telegram" value={query} onChange={setQuery} />
            </div>
          }
        >
          {!data ? (
            <Empty text="Cargando..." />
          ) : users.length === 0 ? (
            <Empty text={query ? 'Ningún usuario coincide con la búsqueda.' : 'Todavía no hay usuarios.'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary">
                  <tr>
                    <Th>Usuario</Th>
                    <Th>Plan</Th>
                    <Th>Acceso hasta</Th>
                    <Th>Estado</Th>
                    <Th>Telegram</Th>
                    <Th>Hoy</Th>
                    <Th className="text-right">Acciones</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {users.map((u) => {
                    const state = userState(u);
                    return (
                      <tr key={u.id}>
                        <Td>
                          <Person name={u.name} sub={u.username} />
                        </Td>
                        <Td>
                          <Badge size="md" color={u.role === 'admin' ? 'purple' : u.plan === 'lifetime' ? 'brand' : 'gray'}>
                            {u.role === 'admin' ? 'Administrador' : u.planName}
                          </Badge>
                        </Td>
                        <Td>{u.expiresAt ? formatDay(u.expiresAt) : 'De por vida'}</Td>
                        <Td>
                          <Badge size="md" color={state.color}>
                            {state.label}
                          </Badge>
                        </Td>
                        <Td>{u.telegramUsername ? `@${u.telegramUsername}` : '—'}</Td>
                        <Td>{u.downloadsToday}</Td>
                        <Td>
                          <div className="flex justify-end">
                            {u.role !== 'admin' && (
                              <Button size="sm" color={u.status === 'banned' ? 'secondary' : 'tertiary'} isDisabled={Boolean(busy)} onPress={() => toggleBan(u)}>
                                {u.status === 'banned' ? 'Desbloquear' : 'Bloquear'}
                              </Button>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* Últimos pagos confirmados */}
        <Panel title="Últimos pagos confirmados">
          {!data || data.recentPaid.length === 0 ? (
            <Empty text={data ? 'Aún no hay pagos confirmados.' : 'Cargando...'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary">
                  <tr>
                    <Th>Referencia</Th>
                    <Th>Cliente</Th>
                    <Th>Plan</Th>
                    <Th>Monto</Th>
                    <Th>Confirmado</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {data.recentPaid.map((p) => (
                    <tr key={p.reference}>
                      <Td className="font-mono font-semibold text-primary">{p.reference}</Td>
                      <Td>
                        <Person name={p.payerName || p.telegramName} sub={p.username} />
                      </Td>
                      <Td>{PLAN_NAMES[p.plan]}</Td>
                      <Td className="font-semibold text-primary">{formatMoney(p.amount)}</Td>
                      <Td>{formatDateTime(p.confirmedAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </main>
    </div>
  );
}

export default function Admin() {
  const { status, user } = useAuth();

  if (status === 'loading') return <p className="mt-32 text-center text-sm text-tertiary">Cargando...</p>;

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-4 py-10">
        <Login />
      </main>
    );
  }

  if (user.role !== 'admin') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <FeaturedIcon icon={AlertCircle} theme="modern" color="warning" size="xl" />
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-primary">Esta sección es solo para el administrador</h1>
        <p className="text-md text-tertiary">Tu cuenta no tiene permiso para ver el panel.</p>
        <Button size="lg" color="primary" href="/app">
          Ir a la app
        </Button>
      </main>
    );
  }

  return <Dashboard />;
}
