#!/usr/bin/env bash
# Levanta y detiene duokit en local, sin ocupar la terminal.
#   ./services.sh start|stop|restart|status
# Backend (API + bot de Telegram) en :3001 y frontend de desarrollo (Vite) en :5174.
# Solo detiene procesos que corren dentro de esta carpeta: nunca toca otros proyectos que usen otros puertos.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-5174}"

pid_on_port() { ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2; }

# ¿El proceso corre dentro de esta carpeta? (así se distingue de otro proyecto que use otro puerto)
is_mine() { [ -n "$1" ] && case "$(readlink "/proc/$1/cwd" 2>/dev/null)" in "$ROOT"|"$ROOT"/*) true ;; *) false ;; esac; }

start_service() { # nombre puerto carpeta log comando...
  local name=$1 port=$2 dir=$3 log=$4; shift 4
  local pid; pid="$(pid_on_port "$port")"
  if [ -n "$pid" ]; then
    if is_mine "$pid"; then echo "$name: ya está corriendo en :$port (pid $pid)"; return 0; fi
    echo "$name: el puerto :$port lo usa otro programa (pid $pid); no lo toco." >&2; return 1
  fi
  (cd "$dir" && setsid nohup "$@" >>"$log" 2>&1 </dev/null &)
  for _ in $(seq 1 60); do sleep 0.25; pid="$(pid_on_port "$port")"; [ -n "$pid" ] && break; done
  if [ -n "$pid" ]; then echo "$name: arriba en :$port (pid $pid) · log: ${log#"$ROOT"/}"; else echo "$name: NO arrancó; mira ${log#"$ROOT"/}" >&2; return 1; fi
}

stop_service() { # nombre puerto
  local name=$1 port=$2 pid; pid="$(pid_on_port "$port")"
  if [ -z "$pid" ]; then echo "$name: no estaba corriendo"; return 0; fi
  if ! is_mine "$pid"; then echo "$name: el puerto :$port lo usa otro programa (pid $pid); no lo toco." >&2; return 1; fi
  kill "$pid"
  for _ in $(seq 1 40); do sleep 0.25; [ -z "$(pid_on_port "$port")" ] && { echo "$name: detenido"; return 0; }; done
  kill -9 "$pid" 2>/dev/null; echo "$name: detenido a la fuerza"
}

status_service() {
  local name=$1 port=$2 pid; pid="$(pid_on_port "$port")"
  if [ -z "$pid" ]; then echo "$name: apagado (:$port libre)"
  elif is_mine "$pid"; then echo "$name: corriendo en :$port (pid $pid)"
  else echo "$name: :$port lo usa OTRO programa (pid $pid)"; fi
}

case "${1:-status}" in
  start)
    start_service backend "$BACKEND_PORT" "$ROOT/backend" "$ROOT/backend/server.log" node server.js
    start_service frontend "$FRONTEND_PORT" "$ROOT" "$ROOT/vite.log" "$ROOT/node_modules/.bin/vite" --port "$FRONTEND_PORT" --strictPort
    ;;
  stop) stop_service frontend "$FRONTEND_PORT"; stop_service backend "$BACKEND_PORT" ;;
  restart) "$0" stop; "$0" start ;;
  status) status_service backend "$BACKEND_PORT"; status_service frontend "$FRONTEND_PORT" ;;
  *) echo "Uso: $0 start|stop|restart|status"; exit 1 ;;
esac
