# duokit

Descargador de YouTube: descarga video/audio/miniatura de YouTube (con recorte opcional por tiempo)
usando `yt-dlp`. Frontend React + Vite + Tailwind y backend local
Node.js/Express que ejecuta `yt-dlp` sin concatenar comandos (args como arreglo).

## Requisitos

- `yt-dlp` y `ffmpeg` en el `PATH`.
- `npm install && npm install --prefix backend`

## Uso

```bash
npm start   # backend en :3001 + Vite en :5173
```

Los archivos llegan por la descarga normal del navegador (barra de descargas); no se guardan en el proyecto.

## Interfaz

- Componentes de [Untitled UI](https://www.untitledui.com/react/components) (botón, inputs, select, checkbox, progreso) en `src/components/base/`.
- [Animated Counter](https://www.rareui.com/components) de RareUI en `src/components/ui/` (porcentaje de progreso).
- [`page-mascot`](https://koboyo.com/page-mascot): el koala de `public/mascots/`.
- Fondo animado en `src/Pattern.jsx`.

## Usuarios (inicio de sesión)

No hay registro público: los usuarios los crea quien administra duokit. El usuario va en minúsculas (3 a 32 caracteres: letras, números, punto, guion o guion bajo).

```bash
npm run user:add      # pide usuario (para entrar), nombre (el que se muestra) y contraseña (mín. 8)
npm run user:list
npm run user:expire -- ana 2026-12-31   # cambia el último día de acceso (o `nunca`)
npm run user:remove -- ana
```

- Los usuarios se guardan en `backend/data/users.json` con la contraseña cifrada
  (scrypt). Ese archivo y `backend/data/secret.key` (firma de las sesiones) no
  se deben compartir ni subir a git.
- La sesión va en una cookie `httpOnly` que se borra al cerrar el navegador y vence a las 24 horas
  (`SESSION_HOURS` en `backend/auth.js`).
- Tras 5 intentos fallidos con el mismo usuario se bloquea el acceso 15 minutos.
- Cada usuario puede tener una **fecha límite de acceso** (`AAAA-MM-DD` = último día en que puede
  entrar, hasta las 23:59 hora del servidor). Pasada esa fecha no puede iniciar sesión y, si ya tenía
  la sesión abierta, la siguiente acción lo devuelve al login con el aviso. Sin fecha = sin vencimiento.
- En la app se muestra arriba a la derecha: "Acceso hasta el 31 dic 2026", y en amarillo
  ("Tu acceso vence en 5 días") durante la última semana.

## Cómo llegan los archivos

Al terminar, el navegador inicia solo la descarga de cada archivo y aparece en su barra de descargas.
`yt-dlp` los prepara en una carpeta temporal fuera del proyecto (`~/.cache/duokit/jobs/`, configurable con
`DUOKIT_TMP_DIR`), donde quedan 10 minutos por si hay que repetir la descarga (`DUOKIT_FILE_TTL_MS`).
Después se borran solos, y también al apagar el backend. Cada usuario solo puede bajar sus propios archivos.
# duokit
