#!/usr/bin/env bash
# Arranca Mi Panel en local.   Uso: ./start.sh [puerto]
set -e
cd "$(dirname "$0")"
PORT="${1:-8000}"

if ! command -v python3 >/dev/null; then
  echo "Falta python3. En Arch: sudo pacman -S python"
  exit 1
fi

echo "Mi Panel -> http://localhost:$PORT   (Ctrl+C para parar)"

# IP local, por si quieres probar desde el movil en la misma Wi-Fi
IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
[ -n "$IP" ] && echo "Misma Wi-Fi -> http://$IP:$PORT"

# Abre el navegador (si hay entorno grafico)
(sleep 1; xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true) &

exec python3 -m http.server "$PORT"
