#!/usr/bin/env bash
# Abre Mi Panel de forma PRIVADA para tu movil desde cualquier red, usando Tailscale.
# Solo los dispositivos de tu cuenta de Tailscale pueden entrar.   Uso: ./remote.sh [puerto]
set -e
cd "$(dirname "$0")"
PORT="${1:-8000}"

if ! command -v python3 >/dev/null; then
  echo "Falta python3. En Arch: sudo pacman -S python"
  exit 1
fi

if ! command -v tailscale >/dev/null; then
  echo "Falta Tailscale. En Arch:"
  echo "  sudo pacman -S tailscale"
  echo "  sudo systemctl enable --now tailscaled"
  echo "  sudo tailscale up"
  exit 1
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale no esta conectado. Ejecuta:"
  echo "  sudo systemctl enable --now tailscaled"
  echo "  sudo tailscale up"
  exit 1
fi

# Servidor local solo accesible desde este PC; Tailscale lo publica con HTTPS
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!

cleanup() {
  tailscale serve reset >/dev/null 2>&1 || true
  kill "$SERVER_PID" 2>/dev/null || true
  echo "Acceso remoto parado."
}
trap cleanup EXIT
trap 'exit 0' INT TERM

if ! tailscale serve --bg "$PORT"; then
  echo
  echo "Si fallo por permisos, ejecuta UNA vez:  sudo tailscale set --operator=\$USER"
  exit 1
fi

echo
tailscale serve status
echo
echo "Abre la direccion https de arriba en el movil (con la app de Tailscale activada)."
echo "Ctrl+C para parar."
wait "$SERVER_PID"
