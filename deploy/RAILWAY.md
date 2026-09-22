# Desplegar duokit en Railway

Un solo servicio: el `Dockerfile` de la raíz construye el frontend y lo deja junto al backend, que lo sirve él mismo
(Railway no trae nginx; el propio Railway hace de proxy). Estado de lo que hay en este repo:

- **Probado de verdad:** el backend sirviendo el frontend compilado (`npm test --prefix backend`, y a mano con `curl`).
- **Probado en local, no en Railway:** el diagnóstico de bloqueo de YouTube (`/api/admin/ytdlp-diagnose`) — aquí, con IP
  residencial, todo pasa sin ajustes. Hay que correrlo ya desplegado para saber si Railway necesita algo distinto.
- **No probado:** el propio `Dockerfile` con un `docker build` real (este entorno no tenía acceso al demonio de Docker).
  Revisa el registro de construcción del primer deploy en Railway antes de confiar en él.

## 0. Lo único que hace falta de tu lado para empezar

Autenticarte una vez. Escribe esto tal cual (con el `!` al inicio, para que corra en esta sesión):

```
! /home/oldroot/.npm-global/bin/railway login
```

Abre un navegador (o te da un código de dispositivo si no hay pantalla). En cuanto quede hecho, el resto de esta guía
lo puedo ejecutar yo por CLI: crear el proyecto, la variable, el volumen, el deploy y la prueba de bloqueo por SSH.

## 1. Datos que debes tener a la mano (nunca los pegues en el chat; te los pediré uno por uno cuando toque)

- Tu clave secreta de Stripe (`STRIPE_SECRET_KEY`) y, después de crear el webhook, `STRIPE_WEBHOOK_SECRET` (ver README.md). Stripe pide tus datos fiscales (RFC) para activarse en México, aparte de esto.

## 2. Lo que voy a crear en Railway

1. **Proyecto y servicio**, desplegado desde este `Dockerfile` (`railway init`, `railway up`).
2. **Un volumen persistente montado en `/data`**, con `DATA_DIR=/data`. **Esto es obligatorio**: sin volumen, el
   sistema de archivos del contenedor se reinicia en cada deploy y se pierden usuarios, pagos y sesiones.
3. **Variables de entorno**: las de arriba, más `HOST=0.0.0.0`, `TRUST_PROXY=1`, `PORT` (Railway la pone sola),
   `PUBLIC_URL` (con el dominio que Railway te dé, o el tuyo propio una vez lo conectes).
4. **Dominio**: uno gratis de Railway para empezar (`railway domain`); el tuyo propio cuando quieras (paso 5).

## 3. Primera prueba: ¿bloquea YouTube desde Railway?

Ya desplegado, sin exponer nada por HTTP, corro el diagnóstico directo en el contenedor real:

```bash
railway ssh -- node -e "require('./diagnose').diagnose().then(r => console.log(JSON.stringify(r, null, 2)))"
```

- Si dice "ya funciona": seguimos, sin gastar nada.
- Si dice que `player_client=android` (o similar) lo arregla: pongo `YTDLP_PLAYER_CLIENT=android` como variable y
  redespliego. Sigue sin costo.
- Si todo falla: ahí sí toca decidir entre proxy residencial de pago por GB o el híbrido con tu PC en Tuxtla — como
  quedamos, nada de eso se contrata sin que tú lo confirmes primero.

## 4. Encender Stripe y el primer administrador

```bash
railway variables set STRIPE_SECRET_KEY=...
# Después de crear el webhook en el Dashboard de Stripe (apuntando a https://tudominio.com/api/webhook/stripe):
railway variables set STRIPE_WEBHOOK_SECRET=...
railway ssh -- node scripts/users.js admin   # el contenedor ya arranca dentro de backend/, por el WORKDIR del Dockerfile
```

(La contraseña del administrador se imprime una sola vez en esa terminal — apúntala ahí mismo.)

## 5. Dominio propio

```bash
railway domain tudominio.com
railway domain status tudominio.com   # te da el CNAME que debes crear en tu proveedor de DNS
```

Crea ese registro en tu proveedor de dominio (fuera de Railway; eso no lo puedo hacer yo). Cuando resuelva, actualiza
`PUBLIC_URL` a `https://tudominio.com` y reconstruye el frontend (es a donde Stripe regresa al cliente después de pagar).

## 6. Antes de vender de verdad

- [ ] `/api/admin/ytdlp-diagnose` en verde (o ya resuelto con proxy/cookies).
- [ ] Compra de prueba real ya desplegado: elige un plan en el sitio → aceptar términos → pagar de verdad en Stripe →
      en `/pago` deben aparecer tu usuario y contraseña → entrar con esas credenciales y descargar algo.
- [ ] `railway ssh -- df -h /data` (o el equivalente) para confirmar que el volumen quedó montado antes de crear el
      primer usuario real — si no, ese usuario se perdería en el siguiente deploy.
- [ ] Un respaldo del volumen fuera de Railway (Railway no lo hace por ti). `deploy/backup.sh` sirve si migras a un
      VPS tradicional más adelante; en Railway, lo más simple es `railway volume files` o programar un
      `railway ssh -- tar czf - /data` con salida a algún lado tuyo — lo armamos cuando lleguemos a este punto.
- [ ] Revisa los registros del primer deploy (`railway logs`) buscando que no aparezca la clave de Stripe: no se
      imprime en el código (se usa directo desde `process.env`), pero es la comprobación final.
