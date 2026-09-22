# duokit

Descargador de YouTube (video, audio y miniatura, con recorte por tiempo) que se vende por suscripción:
los clientes compran por **Telegram**, pagan por **transferencia SPEI** y reciben su acceso automáticamente.

- **Frontend:** React + Vite + Tailwind + Untitled UI.
- **Backend:** Node.js/Express + `yt-dlp`. Sin base de datos: todo en archivos JSON dentro de `backend/data/`.
- **Rutas:** `/` página pública (landing) · `/app` la aplicación · `/admin` panel del administrador.

## Puesta en marcha

Requisitos: `yt-dlp` y `ffmpeg` en el `PATH`, y Node 22.

```bash
npm install && npm install --prefix backend
cp backend/.env.example backend/.env     # y rellena el token (ver abajo)
npm run user:admin                       # crea el administrador (muestra su contraseña una sola vez)
npm start                                # backend en :3001 + Vite en :5173
```

### 1. Crear el bot de Telegram
1. En Telegram habla con **@BotFather** → `/newbot` → elige nombre y usuario del bot.
2. Copia el token que te da y pégalo en `backend/.env` como `TELEGRAM_BOT_TOKEN=...`.
3. Reinicia (`npm start`). En la consola debe salir `Bot de Telegram activo: @tu_bot`.
4. **Desde la cuenta @tostilocos**, escríbele `/start` al bot. Así el bot sabe a qué chat mandarte los avisos de pago.
5. (Opcional) En `.env`, `PUBLIC_URL` es la dirección pública de la app: aparece en el mensaje con el acceso del cliente.
6. Para que los botones de la landing lleven al bot (y no a tu perfil), crea un archivo `.env` en la raíz del proyecto con
   `VITE_TELEGRAM_URL=https://t.me/el_usuario_de_tu_bot` y reinicia. Las compras y las contraseñas van siempre por el chat
   privado con el bot, nunca en un grupo.

### 2. Flujo de una venta
1. El cliente escribe `/comprar` y elige plan. La primera vez el bot le pide su **nombre completo** (como aparece en su banco);
   así, en tu estado de cuenta reconoces quién pagó. Ese nombre es el que se muestra en su cuenta y en el recibo. Después el bot le da la referencia (`DUO-2026-001`, `-002`...) con el texto
   *"Transfiere $129.00 MXN a esta tarjeta de débito: <tu cuenta> con referencia: DUO-2026-001 JUAN PEREZ"* y su **recibo en PDF**.
   La referencia lleva **su nombre** (sin acentos ni símbolos y en máximo 40 caracteres, como aceptan los bancos en el concepto), así
   en tu estado de cuenta ves de un vistazo quién pagó. El identificador interno sigue siendo `DUO-2026-001` (es el que usas en `/confirmar`).
2. Te llega un aviso por Telegram ("Pago pendiente", con su nombre y su @usuario) y aparece en `/admin`. Si el cliente toca "Ya pagué", te avisa otra vez.
3. Cuando ves la transferencia, la confirmas: botón **Confirmar** en `/admin` o `/confirmar DUO-2026-001 129` en el bot
   (el monto es lo que te llegó al banco; si no coincide con el del plan, el bot no activa nada).
4. Se crea el usuario (o se renueva el existente), y el cliente recibe usuario, contraseña y el recibo pagado por Telegram.

Comandos del bot: `/comprar` `/estado` `/recuperar` (contraseña nueva) `/ayuda`. Del administrador (menú solo en tu chat): `/resumen` `/pendientes` `/confirmar REF MONTO`.

### Comandos del administrador

- `/resumen` — el panorama de un vistazo: **por activar** (cuántos, cuánto dinero está por cobrar, quién dice que ya pagó y hace cuánto),
  **activados** (hoy, este mes y total, por plan, y los últimos 5) y clientes (activos, los que vencen en 7 días o menos, bloqueados).
- `/pendientes` — la lista completa de pagos pendientes, con el concepto que debes buscar en el banco.
- `/confirmar REFERENCIA MONTO` — activa el pago cuando ves la transferencia.

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
- **Bloqueo automático** al chocar con un límite 5 veces en 24 h (los choques con el tope por minuto cuentan una vez por minuto; con el tope diario, una vez por hora). Te avisa por Telegram y lo puedes desbloquear en `/admin` (al desbloquear se borran sus choques).
- **Protección del servidor** (también en `backend/plans.js`): máximo 2 descargas a la vez por usuario y 4 en todo el servidor, cada descarga se cancela a los 20 min, no se bajan transmisiones en vivo, archivos de más de 2 GB ni videos de más de 3 h (con el recorte por tiempo sí se puede bajar un fragmento de un video largo).
- **Auditoría:** `backend/data/audit.log` guarda una línea por descarga (usuario, IP, enlace, calidad), inicio de sesión, pago y bloqueo.

## Panel de administración (`/admin`)

Entras con el usuario `admin`. Muestra ingresos totales, usuarios activos, descargas (hoy y total), pagos pendientes con
**Confirmar/Cancelar**, todos los usuarios (plan, vencimiento, estado, descargas de hoy) con **Bloquear/Desbloquear**, y los últimos pagos.

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
- Contraseñas con `scrypt`; sesión en cookie `httpOnly`; peticiones de otros sitios rechazadas; 5 intentos de login fallidos (por cuenta y desde la misma IP) bloquean 15 min; el intento se cuenta al instante, así que una ráfaga simultánea tampoco se cuela.
- El administrador se reconoce por su **ID numérico** de Telegram (se fija solo la primera vez que `@tostilocos` le escribe al bot, o lo pones en `ADMIN_TELEGRAM_ID`), no por su @usuario.
- Al pedir `/recuperar` se cierran todas las sesiones abiertas de esa cuenta.
- Los archivos descargados no se guardan en el proyecto: llegan por la descarga del navegador y se borran solos a los 10 minutos
  (`~/.cache/duokit/jobs/`).
- Detrás de nginx/Cloudflare pon `TRUST_PROXY=1` en `backend/.env` para ver la IP real del cliente, y sirve todo por HTTPS.
