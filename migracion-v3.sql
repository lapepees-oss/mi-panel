-- Cloudspace en Mi Panel (v3): prioridades 1-4, proyectos iniciales, hábitos con icono,
-- diario, finanzas (movimientos, presupuestos, objetivos de ahorro).
--
-- Ejecútalo UNA vez en Supabase > SQL Editor > New query > Run. Si lo repites no pasa nada.
-- Orden: schema.sql (v1) -> migracion-v2.sql -> este archivo -> single-user.sql (con tu correo).
-- No borra ningún dato existente.

do $$
begin
  if to_regclass('public.task_lists') is null then
    raise exception 'Ejecuta primero migracion-v2.sql (falta la tabla task_lists).';
  end if;
end $$;

-- ---------- Tareas ----------
alter table public.tasks add column if not exists completed_at timestamptz;

-- Conversión única: la prioridad antigua (0 ninguna .. 3 alta) pasa a P4 .. P1.
-- "Mi día" pasa a ser la fecha límite de hoy (solo en tareas sin fecha y sin completar).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'prio'
  ) then
    alter table public.tasks add column prio smallint not null default 4;
    alter table public.tasks add constraint tasks_prio_check check (prio between 1 and 4);
    update public.tasks set prio = 4 - priority where priority between 0 and 3;
    update public.tasks set due_date = my_day_date
      where due_date is null and my_day_date is not null and not done;
    update public.tasks set completed_at = created_at where done and completed_at is null;
  end if;
end $$;

-- ---------- Hábitos ----------
alter table public.habits add column if not exists emoji text not null default '🌱';
alter table public.habits add column if not exists hint text not null default '';

-- ---------- Proyectos iniciales (solo si todavía no tienes ninguno) ----------
insert into public.task_lists (user_id, name)
select u.id, p.name
from auth.users u
cross join (values ('Personal'), ('Estudios'), ('Salud'), ('Trabajo'), ('Compras')) as p(name)
where not exists (select 1 from public.task_lists l where l.user_id = u.id);

-- ---------- Diario ----------
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'entry' check (kind in ('entry', 'quick')),
  entry_date date not null,
  body text not null default '' check (char_length(body) <= 200000),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, entry_date)
);

-- ---------- Finanzas ----------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  amount numeric(12, 2) not null check (amount > 0),
  title text not null check (char_length(title) between 1 and 120),
  category text not null default 'Otros',
  tx_date date not null,
  created_at timestamptz not null default now()
);

-- category = '' es el presupuesto mensual total; el resto son presupuestos por categoría
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null default '',
  amount numeric(12, 2) not null check (amount >= 0),
  unique (user_id, category)
);

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  target numeric(12, 2) not null check (target > 0),
  current numeric(12, 2) not null default 0 check (current >= 0),
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, tx_date);
create index if not exists journal_user_date_idx on public.journal_entries (user_id, entry_date);

-- ---------- Seguridad: cada cuenta solo ve sus filas ----------
alter table public.journal_entries enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;

do $$
declare t text;
begin
  foreach t in array array['journal_entries', 'transactions', 'budgets', 'savings_goals'] loop
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
  foreach t in array array['journal_entries', 'transactions', 'budgets', 'savings_goals'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- IMPORTANTE: si ya habías ejecutado single-user.sql, vuelve a ejecutarlo (con tu correo)
-- después de este archivo para que las tablas nuevas también queden bloqueadas a tu cuenta.
