# duokit

Descargador de YouTube (video, audio y miniatura, con recorte por tiempo) que se vende por suscripción:
el cliente elige su plan en el sitio, paga con **tarjeta por Mercado Pago (Checkout Pro)** y su cuenta queda lista
al momento, en la misma pantalla — sin bot, sin que nadie confirme nada a mano.

- **Frontend:** React + Vite + Tailwind + Untitled UI.
- **Backend:** Node.js/Express + `yt-dlp`. Sin base de datos: todo en archivos JSON dentro de `backend/data/`.
- **Rutas:** `/` página pública (landing, con los planes) · `/app` la aplicación · `/admin` panel del administrador
  · `/pago` a donde Mercado Pago regresa al cliente después de pagar.

## Puesta en marcha

Requisitos: `yt-dlp` y `ffmpeg` en el `PATH`, y Node 22.

```bash
npm install && npm install --prefix backend
cp backend/.env.example backend/.env     # y rellena las claves de Mercado Pago (ver abajo)
npm run user:admin                       # crea el administrador (muestra su contraseña una sola vez)
npm start                                # backend en :3001 + Vite en :5173
```

### Configurar Mercado Pago

1. Crea una cuenta en [mercadopago.com.mx/developers](https://www.mercadopago.com.mx/developers) y actívala (Mercado
   Pago pide tus datos fiscales para poder pagarte: ver "Datos y seguridad" abajo).
2. En "Tus integraciones", copia el access token (`TEST-...` para probar primero, `APP_USR-...` cuando ya cobres de
   verdad) a `backend/.env` como `MERCADOPAGO_ACCESS_TOKEN=...`.
3. En la misma sección, Webhooks → Configurar notificaciones, apunta a `https://tudominio.com/api/webhook/mercadopago`
   y copia la "Clave secreta" (distinta del access token) a `backend/.env` como `MERCADOPAGO_WEBHOOK_SECRET=...`.
4. Reinicia. Sin `MERCADOPAGO_ACCESS_TOKEN`, el sitio responde "Las compras no están disponibles por ahora" en vez de
   vender; sin `MERCADOPAGO_WEBHOOK_SECRET`, las compras se pueden iniciar pero nunca se confirman solas (usa
   `/admin` para confirmar a mano mientras tanto).

`PUBLIC_URL` en `backend/.env` es a dónde Mercado Pago regresa al cliente después de pagar (`/pago`); ponla en tu dominio real.

### Flujo de una venta

1. El cliente marca la casilla de términos, elige un plan y toca "Comprar". El sitio crea la preferencia de pago y
   lo manda directo a Mercado Pago.
2. En Mercado Pago paga con tarjeta y da su correo y nombre (Mercado Pago los recoge al cobrar; duokit nunca ve el
   número de tarjeta). Solo se aceptan pagos que se resuelven al momento (`binary_mode`): nada de pagos en efectivo
   (OXXO, etc.) que tardan días.
3. Mercado Pago avisa al backend por el webhook; la cuenta se crea (o se renueva, si el correo ya tenía una) sola.
4. Mercado Pago regresa al cliente a `/pago`, que consulta si ya está lista y muestra su **usuario y contraseña** ahí
   mismo (la contraseña sale difuminada, con un botón para revelarla — es la única vez que se muestra) y el recibo en PDF.

No hay ningún aviso push para ti: nadie te escribe cuando entra una venta. Revisa `/admin` de vez en cuando (o el
panel de Mercado Pago, que también lista los cobros) — ahí ves los pagos confirmados, los que se quedaron a medias
y si hay alguna alerta de servicio.

Si el cliente pierde su contraseña: con la sesión abierta puede generar una nueva desde "Mi cuenta" en `/app`
(cierra sus otras sesiones, no la que la pidió). Si ya cerró sesión en todos lados, tienes que restablecérsela tú
desde `/admin` y dársela por donde te contacte.

## Planes y límites

| | Básico | Permanente |
|---|---|---|
| Precio | $129 MXN/mes | $2,999 MXN único |
| Acceso | 30 días (renovar suma 30 más) | De por vida |
| Calidad | hasta 1080p | hasta 4K |
| Descargas por día | 30 | 150 |

Todo esto se cambia en `backend/plans.js`. Protecciones anti-abuso (también ahí):
- Máximo **5 descargas por minuto** por usuario (`429`).
- Tope **diario** por plan (`429`, se reinicia a medianoche del servidor).
- Máximo **2 sesiones a la vez** por cuenta: al abrir una tercera se cierra la más antigua.
- **Bloqueo automático** al chocar con un límite 5 veces en 24 h (los choques con el tope por minuto cuentan una vez
  por minuto; con el tope diario, una vez por hora). Se ve en `/admin` (la cuenta aparece bloqueada) y se puede
  desbloquear ahí (al desbloquear se borran sus choques).
- **Protección del servidor** (también en `backend/plans.js`): máximo 2 descargas a la vez por usuario y 4 en todo el
  servidor, cada descarga se cancela a los 20 min, no se bajan transmisiones en vivo, archivos de más de 2 GB ni
  videos de más de 3 h (con el recorte por tiempo sí se puede bajar un fragmento de un video largo).
- **Auditoría:** `backend/data/audit.log` guarda una línea por descarga (usuario, IP, enlace, calidad), inicio de
  sesión, pago y bloqueo.
- **Alerta de servicio:** si 3 descargas seguidas fallan por YouTube/yt-dlp, `/admin` muestra un aviso (suele
  arreglarse con `pipx upgrade yt-dlp`).

## Panel de administración (`/admin`)

Entras con el usuario `admin`. Muestra ingresos totales, usuarios activos, descargas (hoy y total), pagos sin
completar (checkouts de Mercado Pago abandonados, con **Cancelar** — no hay botón de confirmar a mano en condiciones
normales: eso lo hace Mercado Pago solo), todos los usuarios (plan, vencimiento, estado, correo, descargas de hoy)
con **Bloquear/Desbloquear** y **Restablecer** contraseña, y los últimos pagos.

## Usuarios desde la terminal

```bash
npm run user:add                              # crea un usuario a mano (usuario, nombre, vencimiento, plan)
npm run user:list
npm run user:passwd -- cliente1                    # cambia una contraseña (también la del admin)
npm run user:expire -- cliente1 2026-12-31         # último día de acceso (o `nunca`)
npm run user:remove -- cliente1
```

## Datos y seguridad

- `backend/data/` (usuarios, pagos, sesiones, auditoría, clave de firma) y `backend/.env` **no se suben a git** ni se comparten.
- **Mercado Pago exige datos fiscales (RFC) de la cuenta a la que se le paga** para activarla en México y poder
  retirar a una cuenta bancaria — no hay forma de evitarlo, ni cambiando de procesador (es un requisito regulatorio,
  no de Mercado Pago en particular).
- El webhook (`/api/webhook/mercadopago`) verifica la firma de cada notificación con `MERCADOPAGO_WEBHOOK_SECRET`
  antes de activar nada; una petición sin esa firma (o con una falsa) se rechaza con 400 y no activa ninguna cuenta.
- Contraseñas con `scrypt`; sesión en cookie `httpOnly`; peticiones de otros sitios rechazadas; 5 intentos de login
  fallidos (por cuenta y desde la misma IP) bloquean 15 min; el intento se cuenta al instante, así que una ráfaga
  simultánea tampoco se cuela.
- La contraseña de una cuenta nueva se muestra **una sola vez**, en `/pago` justo después de pagar (o al
  restablecerla desde "Mi cuenta" o desde `/admin`); nunca se guarda en texto claro ni se puede volver a consultar.
- Los archivos descargados no se guardan en el proyecto: llegan por la descarga del navegador y se borran solos a
  los 10 minutos (`~/.cache/duokit/jobs/`).
- Detrás de nginx/Cloudflare pon `TRUST_PROXY=1` en `backend/.env` para ver la IP real del cliente, y sirve todo por HTTPS.

## Contacto de soporte

`VITE_SUPPORT_URL` (en el `.env` de la raíz del proyecto) es el enlace que ven los clientes para pedir ayuda —
por defecto `https://t.me/tostilocos`. Es tu chat personal de Telegram, no un bot: revísalo tú.
