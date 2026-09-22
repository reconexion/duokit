# Despliegue de duokit

Guía para subir duokit a un servidor Linux. Los archivos de esta carpeta son una base: ajusta rutas y dominio.
Estado de cada uno: `backup.sh` **probado**; las unidades de systemd **solo validadas** con `systemd-analyze verify`
(no se instalaron en un servidor); `nginx.conf.example` **no probado** (nginx no estaba instalado).

## 0. Antes de elegir dónde

- **YouTube suele bloquear las IPs de servidores en la nube** ("Sign in to confirm you're not a bot"). Desde una IP de casa
  funciona; desde un VPS puede fallar y exigir cookies o un proveedor con IPs residenciales. Prueba una descarga real en el
  servidor **antes** de vender.
- Si el servidor es tu propia PC: si se apaga o se cae el internet, no hay servicio.

## 1. Servidor

```bash
sudo apt install ffmpeg nginx certbot python3-certbot-nginx pipx rsync    # Node 22 aparte (nodesource o nvm)
sudo useradd -m -s /bin/bash duokit
sudo -iu duokit pipx install yt-dlp
```

## 2. Código y configuración

```bash
sudo git clone <tu-repo-privado> /opt/duokit && sudo chown -R duokit:duokit /opt/duokit
cd /opt/duokit
sudo -u duokit npm ci --omit=dev --prefix backend
cp backend/.env.example backend/.env && nano backend/.env
```

En `backend/.env` pon: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` (del webhook que apunta a `/api/webhook/mercadopago`), `PUBLIC_URL=https://tudominio.com` y **`TRUST_PROXY=1`**.
Crea el administrador (muestra su contraseña una sola vez): `sudo -u duokit npm run user:admin`.

El frontend se compila con el enlace de contacto de soporte (la variable se "hornea" al compilar):

```bash
echo "VITE_SUPPORT_URL=https://t.me/tostilocos" > .env
npm ci && npm run build          # genera dist/
```

## 3. Servicios

```bash
sudo cp deploy/duokit-backend.service deploy/duokit-backup.service deploy/duokit-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now duokit-backend duokit-backup.timer
systemctl status duokit-backend      # revisa que arrancó bien en: journalctl -u duokit-backend
```

## 4. Nginx y HTTPS

Copia `deploy/nginx.conf.example` a `/etc/nginx/sites-available/duokit`, cambia el dominio, crea
`/etc/nginx/duokit-proxy.conf` (las 3 líneas del final del archivo), y:

```bash
sudo ln -s /etc/nginx/sites-available/duokit /etc/nginx/sites-enabled/
sudo certbot --nginx -d tudominio.com
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Respaldos

`duokit-backup.timer` guarda una copia diaria en `/opt/duokit/backups` (las últimas 30). **Eso no basta**: si se pierde el
servidor se pierden también las copias. Manda una copia fuera con `REMOTE_COPY` (ver el `.service`) y, mejor, cífrala.
Prueba restaurar una vez: `tar -xzf duokit-data-*.tar.gz -C /tmp` y revisa que `data/users.json` se vea bien.

## 6. Mantenimiento

- **yt-dlp**: actualízalo seguido (`sudo -iu duokit pipx upgrade yt-dlp`, por ejemplo con un cron semanal). Si varias
  descargas seguidas fallan por YouTube, `/admin` muestra un aviso.
- **Registro de actividad**: se borra solo a los 90 días (`DUOKIT_AUDIT_RETENTION_DAYS` para cambiarlo).
- **Actualizar el código**: `git pull && npm ci && npm run build && sudo systemctl restart duokit-backend`.

## 7. Lista de comprobación antes de vender

- [ ] Descarga real desde el servidor (video, audio, miniatura).
- [ ] Compra de prueba de punta a punta en el sitio real: elige un plan → paga en Mercado Pago → en `/pago` aparecen tu
      usuario y contraseña → entra y descarga algo.
- [ ] `https://tudominio.com/legal` carga y el webhook de Mercado Pago llega (revisa `journalctl -u duokit-backend`).
- [ ] Reiniciar el servidor y comprobar que todo vuelve solo.
- [ ] Restaurar un respaldo de prueba.
