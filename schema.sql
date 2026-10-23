-- Ejecuta este archivo entero en Supabase: SQL Editor > New query > Run

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  day date not null,
  unique (habit_id, day)
);

-- Un único cronómetro por usuario, compartido entre dispositivos
create table if not exists public.timer (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  running boolean not null default false,
  started_at timestamptz,
  accumulated_ms bigint not null default 0,
  label text not null default ''
);

create table if not exists public.timer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null default '',
  duration_ms bigint not null,
  created_at timestamptz not null default now()
);

-- Seguridad: cada usuario solo ve y modifica sus propias filas
alter table public.tasks enable row level security;
alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
alter table public.timer enable row level security;
alter table public.timer_sessions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['tasks','habits','habit_logs','timer','timer_sessions'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;

-- Sincronización en tiempo real
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.habits;
alter publication supabase_realtime add table public.habit_logs;
alter publication supabase_realtime add table public.timer;
alter publication supabase_realtime add table public.timer_sessions;
