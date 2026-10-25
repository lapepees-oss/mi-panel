-- Mi Panel v2: listas, pasos, prioridades, etiquetas, repeticion y rutinas del cronometro.
-- Ejecutalo UNA vez en Supabase > SQL Editor > New query > Run (si lo repites no pasa nada).
-- Hazlo ANTES de subir la nueva version de la app.

-- ---------- Tareas: listas y campos nuevos ----------
create table if not exists public.task_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.tasks
  add column if not exists list_id uuid references public.task_lists(id) on delete set null,
  add column if not exists notes text not null default '',
  add column if not exists due_date date,
  add column if not exists priority smallint not null default 0,
  add column if not exists status text not null default 'todo',
  add column if not exists my_day_date date,
  add column if not exists recurrence text,
  add column if not exists tags text[] not null default '{}';

-- Las tareas ya completadas pasan al estado "done"
update public.tasks set status = 'done' where done and status = 'todo';

do $$
begin
  alter table public.tasks add constraint tasks_status_check check (status in ('todo','doing','done'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.tasks add constraint tasks_priority_check check (priority between 0 and 3);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.tasks add constraint tasks_recurrence_check check (recurrence is null or recurrence in ('daily','weekly','monthly'));
exception when duplicate_object then null;
end $$;

-- Pasos (subtareas)
create table if not exists public.task_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Cronometro: rutinas ----------
create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  cycles int not null default 1 check (cycles >= 0),  -- 0 = sin fin
  created_at timestamptz not null default now()
);

create table if not exists public.routine_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  label text not null,
  seconds int not null check (seconds > 0),
  kind text not null default 'work' check (kind in ('work','break')),
  position int not null default 0
);

alter table public.timer
  add column if not exists mode text not null default 'stopwatch',
  add column if not exists routine_id uuid references public.routines(id) on delete set null;

-- ---------- Seguridad de las tablas nuevas ----------
alter table public.task_lists enable row level security;
alter table public.task_steps enable row level security;
alter table public.routines enable row level security;
alter table public.routine_steps enable row level security;

do $$
declare t text;
begin
  foreach t in array array['task_lists','task_steps','routines','routine_steps'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;

-- ---------- Tiempo real ----------
do $$
declare t text;
begin
  foreach t in array array['task_lists','task_steps','routines','routine_steps'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- IMPORTANTE: si ya habias ejecutado single-user.sql, vuelve a ejecutarlo despues de este
-- archivo (con tu correo) para que las tablas nuevas tambien queden bloqueadas a tu cuenta.
