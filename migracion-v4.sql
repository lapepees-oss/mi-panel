-- Cloudspace (v4): nuevo cronómetro, hábitos con categoría/frecuencia/color y biblioteca de ideas del diario.
--
-- Ejecútalo UNA vez en Supabase > SQL Editor > New query > Run. Si lo repites no pasa nada.
-- Orden: schema.sql -> migracion-v2.sql -> migracion-v3.sql -> este archivo -> single-user.sql (con tu correo).
-- No borra ni modifica datos existentes: solo añade columnas con valores por defecto y una tabla nueva.

do $$
begin
  if to_regclass('public.journal_entries') is null then
    raise exception 'Ejecuta primero migracion-v3.sql (falta la tabla journal_entries).';
  end if;
end $$;

-- ---------- Cronómetro ----------
-- Duración objetivo del modo Temporizador (0 = sin objetivo)
alter table public.timer add column if not exists target_ms bigint not null default 0;
-- Tipo de sesión guardada: stopwatch | timer | pomodoro | routine (las antiguas quedan en null)
alter table public.timer_sessions add column if not exists kind text;

-- ---------- Hábitos ----------
alter table public.habits add column if not exists category text not null default 'Personal';
alter table public.habits add column if not exists frequency text not null default 'Diario';
alter table public.habits add column if not exists color text not null default '#8064ff';

-- ---------- Ideas ----------
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date,                       -- día de la entrada de diario de origen (opcional; no es clave foránea: la idea sobrevive a la entrada)
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ideas_user_created_idx on public.ideas (user_id, created_at desc);
create index if not exists ideas_entry_date_idx on public.ideas (user_id, entry_date);
create index if not exists ideas_tags_idx on public.ideas using gin (tags);

alter table public.ideas enable row level security;
drop policy if exists "own rows" on public.ideas;
create policy "own rows" on public.ideas for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ideas') then
    alter publication supabase_realtime add table public.ideas;
  end if;
exception when others then null;
end $$;
