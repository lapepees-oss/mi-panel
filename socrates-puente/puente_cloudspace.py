#!/usr/bin/env python3
"""
Puente CloudSpace ⇄ Sócrates
============================

Conecta el chat de la web (apartado «Sócrates» de CloudSpace) con Sócrates en tu PC.

Cómo funciona:
  1. Desde la web (móvil o PC) escribes un mensaje → se guarda en Supabase (tabla socrates_messages, estado "pending").
  2. Este script, que corre en tu PC, mira cada pocos segundos si hay mensajes pendientes.
  3. Se los pasa a Sócrates (por defecto, al modelo local de Ollama) y escribe la respuesta en la misma tabla.
  4. La web la recibe al instante por el tiempo real de Supabase.

Así no hace falta abrir puertos en tu casa ni que el móvil esté en la misma red.
Solo usa la librería estándar de Python (no hay que instalar nada con pip). Funciona en Linux y en Windows.

Uso:
  python3 puente_cloudspace.py            → arranca el puente
  python3 puente_cloudspace.py --config   → crea/edita el archivo de configuración y sale
  python3 puente_cloudspace.py --prueba   → manda un mensaje a Sócrates sin pasar por la web (para probar Ollama)

Para conectar tu propio "cerebro" de Sócrates en lugar de Ollama directo, cambia la función responder() (más abajo).
"""

import json
import os
import platform
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from getpass import getpass
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

def ruta_config() -> Path:
    """Devuelve dónde se guarda la configuración (fuera del repositorio, para no subir la contraseña a GitHub)."""
    if platform.system() == "Windows":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "socrates" / "cloudspace.json"


# Valores por defecto. La URL y la clave pública son las de config.js de la web (la clave "publishable" no es secreta).
CONFIG_POR_DEFECTO = {
    "supabase_url": "https://dizhvboudjipkzjtowdm.supabase.co",
    "supabase_anon_key": "sb_publishable_5msflLiAq4meSu5YL8P9hw_kounPn0H",
    "email": "",
    "password": "",
    "ollama_url": "http://localhost:11434",
    "modelo": "qwen2.5:7b",
    "segundos_entre_consultas": 2,
    "mensajes_de_contexto": 12,
}


def crear_config() -> dict:
    """Pregunta por consola los datos de tu cuenta de CloudSpace y los guarda en el archivo de configuración."""
    ruta = ruta_config()
    actual = cargar_config(silencioso=True) or dict(CONFIG_POR_DEFECTO)
    print(f"Configuración del puente → {ruta}")
    print("Pulsa Intro para dejar el valor entre corchetes.\n")
    for clave, texto in [("email", "Correo de tu cuenta de CloudSpace"), ("modelo", "Modelo de Ollama"), ("ollama_url", "Dirección de Ollama")]:
        valor = input(f"{texto} [{actual.get(clave, '')}]: ").strip()
        if valor:
            actual[clave] = valor
    pw = getpass("Contraseña de CloudSpace (no se muestra; Intro para no cambiarla): ")
    if pw:
        actual["password"] = pw
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(actual, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        os.chmod(ruta, 0o600)  # solo tu usuario puede leerlo (en Windows no tiene efecto, no pasa nada)
    except OSError:
        pass
    print("\nGuardado.")
    return actual


def cargar_config(silencioso: bool = False) -> dict | None:
    """Lee el archivo de configuración y lo completa con los valores por defecto que falten."""
    ruta = ruta_config()
    if not ruta.exists():
        return None
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        if not silencioso:
            print(f"El archivo {ruta} no es un JSON válido: {e}")
        return None
    return {**CONFIG_POR_DEFECTO, **datos}


def log(msg: str) -> None:
    """Escribe una línea con la hora delante (journalctl/la consola la muestran tal cual)."""
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Peticiones HTTP (sin librerías externas)
# ---------------------------------------------------------------------------

def http(metodo: str, url: str, cuerpo=None, cabeceras: dict | None = None, timeout: float = 20):
    """Hace una petición HTTP y devuelve el JSON de respuesta (o None si viene vacía). Lanza HTTPError si falla."""
    datos = json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo, headers={"Content-Type": "application/json", **(cabeceras or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        texto = r.read().decode("utf-8")
        return json.loads(texto) if texto else None


class Supabase:
    """Cliente mínimo de Supabase: inicia sesión con tu cuenta y lee/escribe las tablas del chat.
    Al iniciar sesión como TÚ, el RLS de la base de datos hace que solo vea tus mensajes."""

    def __init__(self, cfg: dict):
        self.url = cfg["supabase_url"].rstrip("/")
        self.key = cfg["supabase_anon_key"]
        self.email = cfg["email"]
        self.password = cfg["password"]
        self.token = None
        self.refresh = None
        self.caduca = 0.0
        self.user_id = None

    def _guardar_sesion(self, r: dict) -> None:
        """Guarda los tokens que devuelve Supabase al iniciar sesión o renovarla."""
        self.token = r["access_token"]
        self.refresh = r["refresh_token"]
        self.caduca = time.time() + int(r.get("expires_in", 3600)) - 120  # se renueva 2 min antes de caducar
        self.user_id = r["user"]["id"]

    def iniciar_sesion(self) -> None:
        """Entra con correo y contraseña (la misma cuenta que usas en la web)."""
        r = http("POST", f"{self.url}/auth/v1/token?grant_type=password", {"email": self.email, "password": self.password}, {"apikey": self.key})
        self._guardar_sesion(r)

    def asegurar_sesion(self) -> None:
        """Renueva el token si está a punto de caducar; si la renovación falla, vuelve a iniciar sesión."""
        if self.token and time.time() < self.caduca:
            return
        if self.refresh:
            try:
                r = http("POST", f"{self.url}/auth/v1/token?grant_type=refresh_token", {"refresh_token": self.refresh}, {"apikey": self.key})
                self._guardar_sesion(r)
                return
            except urllib.error.HTTPError:
                pass
        self.iniciar_sesion()

    def rest(self, metodo: str, tabla: str, query: str = "", cuerpo=None, prefer: str | None = None):
        """Llama a la API REST de Supabase (PostgREST) sobre una tabla, con tu sesión."""
        self.asegurar_sesion()
        cab = {"apikey": self.key, "Authorization": f"Bearer {self.token}"}
        if prefer:
            cab["Prefer"] = prefer
        return http(metodo, f"{self.url}/rest/v1/{tabla}{'?' + query if query else ''}", cuerpo, cab)

    # --- Operaciones del chat ---

    def pendientes(self) -> list:
        """Tus mensajes que aún no ha respondido Sócrates, del más antiguo al más nuevo."""
        return self.rest("GET", "socrates_messages", "role=eq.user&status=eq.pending&order=created_at.asc,id.asc&limit=5") or []

    def reclamar(self, msg_id: int) -> bool:
        """Marca un mensaje como "thinking" solo si seguía "pending" (evita responder dos veces si hay dos puentes abiertos)."""
        r = self.rest("PATCH", "socrates_messages", f"id=eq.{msg_id}&status=eq.pending", {"status": "thinking"}, "return=representation")
        return bool(r)

    def poner_estado(self, msg_id: int, estado: str) -> None:
        """Cambia el estado de uno de tus mensajes (done / error / pending)."""
        self.rest("PATCH", "socrates_messages", f"id=eq.{msg_id}", {"status": estado}, "return=minimal")

    def historial(self, hasta_id: int, cuantos: int) -> list:
        """Los últimos mensajes anteriores al actual, para que Sócrates tenga contexto de la conversación."""
        filas = self.rest("GET", "socrates_messages", f"id=lt.{hasta_id}&status=in.(done)&order=id.desc&limit={cuantos}") or []
        return list(reversed(filas))

    def responder_en_chat(self, texto: str) -> None:
        """Escribe la respuesta de Sócrates en la conversación."""
        self.rest("POST", "socrates_messages", "", {"role": "socrates", "content": texto[:4000], "status": "done"}, "return=minimal")

    def latido(self, modelo: str) -> None:
        """Avisa a la web de que el puente está vivo (la web muestra «Conectado»)."""
        ahora = datetime.now(timezone.utc).isoformat()
        self.rest("POST", "socrates_status", "on_conflict=user_id", {"user_id": self.user_id, "last_seen": ahora, "model": modelo[:80]},
                  "resolution=merge-duplicates,return=minimal")

    def recuperar_atascados(self) -> None:
        """Si el puente se cerró a mitad de una respuesta, ese mensaje se quedó en "thinking": se vuelve a poner en cola."""
        self.rest("PATCH", "socrates_messages", "role=eq.user&status=eq.thinking", {"status": "pending"}, "return=minimal")


# ---------------------------------------------------------------------------
# El "cerebro": aquí se decide qué contesta Sócrates
# ---------------------------------------------------------------------------

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def instrucciones() -> str:
    """Personalidad de Sócrates (la que elegiste): mayordomo con algo de ironía, de usted, breve y en castellano."""
    ahora = datetime.now()
    return (
        "Eres Sócrates, el asistente personal de Matheus. Tienes personalidad de mayordomo británico con un toque de ironía, "
        "al estilo de Jarvis. Le tratas siempre de usted y le llamas «señor». Respondes siempre en castellano de España, "
        "de forma breve y directa: lo mínimo necesario, sin listas largas salvo que te las pida. "
        "Si no sabes algo o no puedes hacerlo desde aquí, lo dices con franqueza. "
        f"Ahora es {DIAS[ahora.weekday()]} {ahora:%d/%m/%Y}, las {ahora:%H:%M}."
    )


def responder(texto: str, historial: list, cfg: dict) -> str:
    """Recibe el mensaje y la conversación previa y devuelve la respuesta de Sócrates.

    Ahora mismo se la pide a Ollama. Si más adelante tienes tu propio núcleo de Sócrates (con acciones, tareas,
    memoria…), cambia el cuerpo de esta función para llamarlo, por ejemplo:
        from socrates_core import procesar
        return procesar(texto, historial)
    """
    mensajes = [{"role": "system", "content": instrucciones()}]
    for m in historial:
        mensajes.append({"role": "user" if m["role"] == "user" else "assistant", "content": m["content"]})
    mensajes.append({"role": "user", "content": texto})
    r = http("POST", cfg["ollama_url"].rstrip("/") + "/api/chat",
             {"model": cfg["modelo"], "messages": mensajes, "stream": False, "options": {"temperature": 0.6}},
             timeout=180)  # un modelo de 7B en CPU puede tardar; con la RTX 2060 suele ser cuestión de segundos
    return (r.get("message") or {}).get("content", "").strip() or "Disculpe, señor: me he quedado en blanco."


# ---------------------------------------------------------------------------
# Bucle principal
# ---------------------------------------------------------------------------

def atender(sb: Supabase, msg: dict, cfg: dict) -> None:
    """Procesa un mensaje pendiente: lo reclama, pide la respuesta y la escribe en el chat."""
    if not sb.reclamar(msg["id"]):
        return  # otro puente se lo ha quedado
    log(f"← {msg['content'][:70]!r}")
    try:
        respuesta = responder(msg["content"], sb.historial(msg["id"], cfg["mensajes_de_contexto"]), cfg)
    except urllib.error.URLError as e:
        log(f"Ollama no responde ({e}). ¿Está arrancado? (ollama serve)")
        sb.responder_en_chat("Me temo que mi cerebro no responde, señor: Ollama no está en marcha en su PC.")
        sb.poner_estado(msg["id"], "error")
        return
    except Exception as e:  # cualquier otro fallo no debe tumbar el puente
        log(f"Error al responder: {e}")
        sb.poner_estado(msg["id"], "error")
        return
    sb.responder_en_chat(respuesta)
    sb.poner_estado(msg["id"], "done")
    log(f"→ {respuesta[:70]!r}")


def bucle(cfg: dict) -> None:
    """Se queda funcionando para siempre: latido cada 20 s y revisión de mensajes cada pocos segundos.
    Si se cae internet o Supabase, espera y lo vuelve a intentar sin cerrarse."""
    sb = Supabase(cfg)
    espera = max(1, float(cfg["segundos_entre_consultas"]))
    ultimo_latido = 0.0
    conectado = False
    while True:
        try:
            if not conectado:
                sb.iniciar_sesion()
                sb.recuperar_atascados()
                conectado = True
                log(f"Conectado a CloudSpace como {sb.email}. Modelo: {cfg['modelo']}. Esperando mensajes…")
            if time.time() - ultimo_latido > 20:
                sb.latido(cfg["modelo"])
                ultimo_latido = time.time()
            for msg in sb.pendientes():
                atender(sb, msg, cfg)
            time.sleep(espera)
        except urllib.error.HTTPError as e:
            cuerpo = e.read().decode("utf-8", "replace")[:300]
            if e.code in (400, 401) and ("invalid_grant" in cuerpo or "Invalid login" in cuerpo or "invalid_credentials" in cuerpo):
                log("Correo o contraseña incorrectos. Ejecuta: python3 puente_cloudspace.py --config")
                sys.exit(1)
            if e.code == 404 or "PGRST205" in cuerpo or "42P01" in cuerpo:
                log("Falta la tabla del chat: ejecuta migracion-v12.sql en el SQL Editor de Supabase.")
            else:
                log(f"Supabase respondió {e.code}: {cuerpo}")
            conectado = False
            time.sleep(15)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            log(f"Sin conexión ({e}). Reintento en 15 s…")
            conectado = False
            time.sleep(15)
        except KeyboardInterrupt:
            log("Hasta luego, señor.")
            return


def main() -> None:
    """Punto de entrada: lee la configuración (o la crea la primera vez) y arranca."""
    if "--config" in sys.argv:
        crear_config()
        return
    cfg = cargar_config()
    if not cfg or not cfg.get("email") or not cfg.get("password"):
        print("Primera vez: configura tu cuenta de CloudSpace.\n")
        cfg = crear_config()
    if "--prueba" in sys.argv:
        texto = " ".join(a for a in sys.argv[1:] if a != "--prueba") or "Hola, Sócrates. ¿Qué hora es?"
        print("Tú:", texto)
        print("Sócrates:", responder(texto, [], cfg))
        return
    bucle(cfg)


if __name__ == "__main__":
    main()
