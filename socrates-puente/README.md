# Puente CloudSpace ⇄ Sócrates

Conecta el apartado **Sócrates** de la web con Sócrates en tu PC. La web guarda tus mensajes en Supabase y este
script (en tu ordenador) los recoge, se los pasa a Sócrates y escribe la respuesta. Funciona desde el móvil sin
abrir puertos en casa. Solo usa Python estándar: no hay que instalar nada con `pip`.

## 1. Base de datos (una vez)

En **Supabase › SQL Editor** ejecuta `migracion-v12.sql` (está en la raíz del repositorio).

## 2. Ollama con un modelo

```bash
ollama pull qwen2.5:7b      # buen castellano y cabe en la RTX 2060 / 16 GB de RAM
ollama serve                # si no lo tienes ya como servicio
```

Puedes usar otro modelo: cámbialo con `--config`.

## 3. Configurar y probar

```bash
python3 puente_cloudspace.py --config     # correo y contraseña de CloudSpace (se guardan en ~/.config/socrates/cloudspace.json)
python3 puente_cloudspace.py --prueba "Hola, ¿qué hora es?"   # prueba Ollama sin pasar por la web
python3 puente_cloudspace.py              # arranca el puente
```

En Windows usa `python` en vez de `python3` (la configuración va a `%APPDATA%\socrates\cloudspace.json`).
Con el puente arrancado, la web muestra **Conectado** junto al título.

## 4. Arranque automático

**Linux (systemd):**

```bash
cp puente_cloudspace.py ~/.config/socrates/
mkdir -p ~/.config/systemd/user && cp socrates-puente.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now socrates-puente
journalctl --user -u socrates-puente -f
```

**Windows:** `Win+R` → `shell:startup` → pon ahí un acceso directo a `arrancar-puente.bat`.

## Conectarlo a tu propio núcleo

Ahora mismo el puente le pregunta directamente a Ollama con la personalidad de Sócrates (mayordomo, de usted,
breve). Cuando tengas tu núcleo con acciones, tareas o memoria, cambia solo la función `responder()` del script.

Por seguridad, el puente **solo contesta con texto**: no ejecuta comandos en tu PC a partir de lo que llegue de la web.
