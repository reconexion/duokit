# Imagen para un hospedaje por contenedor (Railway y similares). Un solo servicio: el backend de Node sirve la API
# (con el webhook de Mercado Pago) y el frontend ya compilado (dist/) — no hay nginx delante, el propio Railway hace de proxy.
#
# NO PROBADO con `docker build` de verdad (este entorno no tenía acceso al demonio de Docker). Sí está probado por
# separado: el backend sirviendo un frontend compilado (test/static.test.js y una prueba manual con curl) y que
# ffmpeg + "pipx install yt-dlp" es exactamente como se instalan en deploy/README.md para un VPS normal. Constrúyela
# una vez en tu máquina o dale a Railway el primer deploy y revisa el registro de construcción antes de confiar en ella.
#
# Construcción en dos pasos: 1) compila el frontend con Node completo, 2) imagen final con Node + yt-dlp + ffmpeg.

FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
# El enlace de contacto de soporte se "hornea" en este paso (variable de build, no de ejecución). Pásala con
# --build-arg en Railway (Settings → Build) o queda el valor por defecto (@tostilocos) de Landing.jsx/Legal.jsx.
ARG VITE_SUPPORT_URL
ENV VITE_SUPPORT_URL=$VITE_SUPPORT_URL
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app

# ffmpeg (unir/convertir video y audio) y yt-dlp instalado con pipx, igual que en deploy/README.md para un VPS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg pipx python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && pipx install yt-dlp
ENV PATH="/root/.local/bin:${PATH}"

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix backend

COPY backend ./backend
COPY --from=frontend /app/dist ./dist

ENV NODE_ENV=production
# Railway asigna el puerto por su cuenta (variable PORT) y espera que el contenedor escuche en todas las interfaces.
ENV HOST=0.0.0.0
EXPOSE 3001

WORKDIR /app/backend
CMD ["node", "server.js"]
