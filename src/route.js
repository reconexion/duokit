// Rutas sin librería: "/" y "/landing" son la página pública, "/app" la aplicación, "/admin" el panel y "/legal" los términos.
export function currentRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path === '/app' || path.startsWith('/app/')) return 'app';
  if (path === '/legal') return 'legal';
  return 'landing';
}
