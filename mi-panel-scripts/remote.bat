@echo off
rem Abre Mi Panel de forma PRIVADA para tu movil desde cualquier red, usando Tailscale.
rem Solo los dispositivos de tu cuenta de Tailscale pueden entrar.
cd /d "%~dp0"
set PORT=8000

set PY=python
where py >nul 2>nul && set PY=py

where %PY% >nul 2>nul
if not %errorlevel%==0 (
  echo Falta Python. Instalalo desde https://www.python.org/downloads/ y marca "Add Python to PATH".
  pause
  exit /b 1
)

where tailscale >nul 2>nul
if not %errorlevel%==0 (
  echo Falta Tailscale. Instalalo desde https://tailscale.com/download/windows e inicia sesion.
  pause
  exit /b 1
)

start "Mi Panel servidor" /min cmd /c "%PY% -m http.server %PORT% --bind 127.0.0.1"
tailscale serve --bg %PORT%
echo.
tailscale serve status
echo.
echo Abre la direccion https de arriba en el movil (con la app de Tailscale activada).
echo Pulsa una tecla para PARAR el acceso remoto.
pause >nul

tailscale serve reset
taskkill /fi "WINDOWTITLE eq Mi Panel servidor*" /f >nul 2>nul
echo Acceso remoto parado.
