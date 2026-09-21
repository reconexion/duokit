// fetch para las rutas protegidas: si el servidor responde 401 (sesión vencida o acceso vencido),
// avisa a la app para que vuelva a la pantalla de login. `detail` trae el mensaje y el código del servidor.
export const UNAUTHORIZED_EVENT = 'duokit:unauthorized';

export async function apiFetch(url, options) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    const detail = await res.clone().json().catch(() => ({}));
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail }));
  }
  return res;
}
