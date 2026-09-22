// Rutas sin librería: "/" y "/landing" son la página pública, "/app" la aplicación, "/admin" el panel, "/legal" los
// términos y "/pago" a donde Mercado Pago regresa al cliente después de pagar (o cancelar) el checkout.
export function currentRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path === '/app' || path.startsWith('/app/')) return 'app';
  if (path === '/legal') return 'legal';
  if (path === '/pago') return 'pago';
  return 'landing';
}
