-- CloudSpace · migración v9: preferencias por usuario (diseño del Resumen y textos editables)
-- Segura y no destructiva: crea UNA tabla nueva. No toca ninguna tabla ni dato existente.
-- Se puede ejecutar más de una vez. Pégala entera en Supabase > SQL Editor y pulsa Run.
--
-- Qué guarda (una fila por usuario):
--   dashboard  → orden, bloques ocultos, tamaños y ajustes de cada bloque del Resumen
--   texts      → textos de la interfaz que has personalizado (id estable → texto)
-- Si NO ejecutas este archivo, la app sigue funcionando: guarda el diseño en este navegador (por usuario)
-- y te avisa de que no se sincroniza entre dispositivos.

create table if not exists public.user_prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  dashboard jsonb not null default '{}'::jsonb check (pg_column_size(dashboard) < 20000),
  texts jsonb not null default '{}'::jsonb check (pg_column_size(texts) < 20000),
  updated_at timestamptz not null default now()
);

alter table public.user_prefs enable row level security;

drop policy if exists "own rows" on public.user_prefs;
create policy "own rows" on public.user_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Si usas single-user.sql, vuelve a ejecutarlo después de este archivo para que cubra también esta tabla.
