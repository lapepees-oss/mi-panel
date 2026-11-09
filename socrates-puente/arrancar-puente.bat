@echo off
REM Arranca el puente CloudSpace - Sócrates en Windows.
REM Para que arranque solo: Win+R, escribe shell:startup y pon ahí un acceso directo a este archivo.
cd /d "%~dp0"
python puente_cloudspace.py
pause
