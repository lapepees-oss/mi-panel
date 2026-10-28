#!/usr/bin/env bash
# Sube los cambios con un solo comando:  ./tools/subir.sh "qué has cambiado"
# Pasa las pruebas, comprueba la caché offline, sube el número de caché, hace commit y push.
set -euo pipefail
cd "$(dirname "$0")/.."
msg="${1:-Actualización}"
node --test tests/*.test.js >/dev/null && echo "Pruebas: OK"
node tools/check.js
node tools/bump-cache.js
git add -A
git commit -m "$msg"
git push
echo "Subido. GitHub Pages se actualiza en 1-2 minutos; recarga con Ctrl+Shift+R."
