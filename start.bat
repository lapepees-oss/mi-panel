@echo off
rem Arranca Mi Panel en local (Windows). Doble clic o: start.bat
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

echo Mi Panel en http://localhost:%PORT%   (Ctrl+C para parar)
start "" "http://localhost:%PORT%"
%PY% -m http.server %PORT%
