-- CloudSpace · migración v12: chat con Sócrates
-- Sustituye el apartado Intelligence por un chat. La web y Sócrates no se hablan directamente:
-- la web escribe tus mensajes en socrates_messages y el puente de tu PC (socrates-puente/puente_cloudspace.py)
-- los lee, se los pasa a Sócrates y escribe la respuesta en la misma tabla. Así funciona desde el móvil
-- sin abrir puertos en casa.
-- Segura y no destructiva: solo crea tablas nuevas. Se puede ejecutar más de una vez.
-- Funciona tanto con single-user.sql como con multiusuario.sql (cada persona solo ve sus filas).

-- 1) Mensajes de la conversación
create table if not exists public.socrates_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'socrates')),
  content text not null check (char_length(content) between 1 and 4000),
  -- Solo importa en los mensajes tuyos: pending (esperando) → thinking (Sócrates lo está leyendo) → done / error
  status text not null default 'done' check (status in ('pending', 'thinking', 'done', 'error')),
  created_at timestamptz not null default now()
);
create index if not exists socrates_messages_user_created on public.socrates_messages (user_id, created_at desc);
create index if not exists socrates_messages_pending on public.socrates_messages (user_id, status) where status in ('pending', 'thinking');
alter table public.socrates_messages enable row level security;

drop policy if exists "own rows" on public.socrates_messages;
create policy "own rows" on public.socrates_messages for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2) Latido del puente: el puente actualiza last_seen cada ~20 s; la web lo usa para mostrar «conectado / desconectado»
create table if not exists public.socrates_status (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  last_seen timestamptz not null default now(),
  model text not null default '' check (char_length(model) <= 80)
);
alter table public.socrates_status enable row level security;

drop policy if exists "own rows" on public.socrates_status;
create policy "own rows" on public.socrates_status for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3) Usuarios pausados (si existe is_blocked() de migracion-v11.sql)
do $$
declare t text;
begin
  if to_regprocedure('public.is_blocked()') is null then return; end if;
  foreach t in array array['socrates_messages', 'socrates_status'] loop
    execute format('drop policy if exists "no bloqueado" on public.%I', t);
    execute format('create policy "no bloqueado" on public.%I as restrictive for all to authenticated using (not public.is_blocked()) with check (not public.is_blocked())', t);
  end loop;
end $$;

-- 4) Tiempo real: las respuestas aparecen en la web al instante.
-- socrates_status NO se publica a propósito: el latido cada 20 s haría repintar toda la app; la web lo consulta ella sola.
do $$
declare t text;
begin
  foreach t in array array['socrates_messages'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
