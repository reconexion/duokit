#!/usr/bin/env bash
# Levanta el backend (yt-dlp) y el frontend (Vite) juntos.
# Ctrl+C detiene ambos procesos.

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  echo ""
  echo "Deteniendo backend..."
  kill "$BACKEND_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "Iniciando backend (yt-dlp) en http://localhost:3001 ..."
(cd "$ROOT_DIR/backend" && npm start) &
BACKEND_PID=$!

sleep 1

echo "Iniciando frontend (Vite)..."
(cd "$ROOT_DIR" && npm run dev)
