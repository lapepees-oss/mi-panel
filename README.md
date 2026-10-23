# Mi Panel

App web instalable (PWA) con **tareas**, **hábitos con rachas** y **cronómetro**, sincronizados en tiempo real entre móvil y PC con Supabase.

## Puesta en marcha

### 1. Crear el proyecto en Supabase (gratis)
1. Entra en https://supabase.com y crea una cuenta.
2. **New project**: ponle nombre, una contraseña de base de datos (guárdala) y la región más cercana (por ejemplo Frankfurt).
3. Espera un par de minutos a que termine de crearse.

### 2. Crear las tablas
1. En el menú izquierdo abre **SQL Editor** > **New query**.
2. Pega el contenido completo de `schema.sql` y pulsa **Run**.

### 3. Simplificar el registro
En **Authentication** > **Sign In / Providers** > **Email**, desactiva **Confirm email**. Así podrás crear tu cuenta y entrar directamente, sin esperar un correo.

### 4. Pegar las claves
1. Ve a **Project Settings** > **API** (o **Data API**).
2. Copia la **Project URL** y la clave **anon public**.
3. Pégalas en `config.js`.

La clave anon es pública por diseño. Tus datos están protegidos por las reglas RLS de `schema.sql`: cada cuenta solo ve sus propias filas. Nunca pegues la clave `service_role` aquí.

### 5. Probarla en el PC
Desde esta carpeta:

```bash
python3 -m http.server 8000
```

Abre http://localhost:8000, pulsa **Crear cuenta** y ya puedes usarla.

### 6. Publicarla para usarla en el móvil
El móvil necesita una dirección HTTPS. Con GitHub Pages es gratis:

1. Crea un repositorio en GitHub y sube estos archivos.
2. En el repositorio: **Settings** > **Pages** > rama `main`, carpeta `/ (root)`.
3. En un minuto tendrás una URL tipo `https://tuusuario.github.io/mi-panel/`.

### 7. Instalarla en el móvil
- **Android (Chrome):** menú ⋮ > **Instalar app** (o **Añadir a pantalla de inicio**).
- **iPhone (Safari):** botón compartir > **Añadir a pantalla de inicio**.

Entra con la misma cuenta que en el PC y verás los mismos datos.

## Cómo funciona
- **Tiempo real:** al cambiar algo en un dispositivo, el otro se actualiza solo.
- **Cronómetro:** guarda la hora de inicio, no los segundos, así sigue contando con la pantalla bloqueada. Puedes iniciarlo en el PC y verlo en el móvil. Si los relojes de ambos dispositivos difieren unos segundos, la hora mostrada puede variar ligeramente.
- **Rachas:** días consecutivos marcados. Si hoy aún no has marcado, la racha cuenta desde ayer, así no se rompe hasta que acaba el día.
- **Sin conexión:** la app abre sin internet, pero los cambios hechos sin conexión **no se guardan** todavía (es la mejora más natural para una v2).

## Nota sobre el plan gratuito
Supabase pausa los proyectos gratuitos tras una semana sin actividad. Si pasa, entra en el panel de Supabase y pulsa **Restore**.

## Estructura
| Archivo | Para qué sirve |
|---|---|
| `index.html` | Estructura de la interfaz |
| `styles.css` | Estilos (modo claro y oscuro automático) |
| `app.js` | Lógica: acceso, tareas, hábitos, cronómetro, tiempo real |
| `config.js` | Tus claves de Supabase |
| `schema.sql` | Tablas, seguridad y tiempo real |
| `sw.js` y `manifest.webmanifest` | Convierten la web en app instalable |

## Ideas para ampliarla
- Cola de cambios sin conexión
- Recordatorios y notificaciones
- Estadísticas de hábitos y tiempo por etiqueta
- Migrar a Flutter reutilizando las mismas tablas
