#!/usr/bin/env bash
# Copia comprimida de backend/data (usuarios, pagos, sesiones, clave de firma, registro de actividad).
# Variables opcionales:
#   BACKUP_DIR   dónde guardar las copias      (por defecto: ./backups junto al proyecto)
#   KEEP         cuántas copias conservar      (por defecto: 30)
#   REMOTE_COPY  copia FUERA del equipo, p. ej. usuario@servidor:/ruta/   (usa rsync sobre ssh)
# Las copias contienen hashes de contraseñas y la clave de firma: quedan en modo 600 y no deben subirse a ningún lado sin cifrar.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT/backend/data}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
KEEP="${KEEP:-30}"

[ -d "$DATA_DIR" ] || { echo "No existe $DATA_DIR" >&2; exit 1; }
umask 077
mkdir -p "$BACKUP_DIR"

file="$BACKUP_DIR/duokit-data-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$file" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
tar -tzf "$file" >/dev/null   # comprueba que el archivo se puede leer

# Conserva solo las KEEP más recientes.
ls -1t "$BACKUP_DIR"/duokit-data-*.tar.gz | tail -n +"$((KEEP + 1))" | xargs -r rm -f

if [ -n "${REMOTE_COPY:-}" ]; then
  rsync -a "$file" "$REMOTE_COPY"
fi
echo "Respaldo listo: $file"
