-- CloudSpace · migración v11: apartado «Administración» (solo administrador)
-- Medición ligera de uso, pausar usuarios y pregunta suave de mejora.
-- Segura y no destructiva: crea tablas y funciones nuevas; no toca datos existentes. Se puede ejecutar más de una vez.
-- Orden: migracion-v2 … v10, después multiusuario.sql y por último ESTE archivo (necesita is_admin()).
--
-- Qué se mide (y solo esto): segundos de uso al día, cuántas veces se abre la app y segundos por módulo (tareas, hábitos…).
-- NO se lee el contenido de nadie: ni tareas, ni notas, ni gastos. El administrador solo ve recuentos agregados.
-- Si NO ejecutas este archivo, la app sigue funcionando; el apartado Administración simplemente no aparece.

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Ejecuta primero multiusuario.sql (falta la función is_admin).';
  end if;
  if to_regclass('public.objectives') is null then
    raise exception 'Ejecuta primero migracion-v10.sql (falta la tabla objectives).';
  end if;
end $$;

-- 1) Usuarios pausados (sin políticas: solo se toca con las funciones de abajo)
create table if not exists public.blocked_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  blocked_at timestamptz not null default now()
);
alter table public.blocked_users enable row level security;

create or replace function public.is_blocked()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocked_users b where b.user_id = auth.uid())
$$;
grant execute on function public.is_blocked() to authenticated;

-- Una persona pausada no puede leer ni escribir sus datos (se conservan; al reactivarla vuelve todo)
do $$
declare t text;
begin
  foreach t in array array[
    'tasks', 'habits', 'habit_logs', 'timer', 'timer_sessions',
    'task_lists', 'task_steps', 'routines', 'routine_steps',
    'journal_entries', 'transactions', 'budgets', 'savings_goals', 'ideas',
    'subscriptions', 'user_prefs', 'objectives'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "no bloqueado" on public.%I', t);
    execute format('create policy "no bloqueado" on public.%I as restrictive for all to authenticated using (not public.is_blocked()) with check (not public.is_blocked())', t);
  end loop;
end $$;

-- 2) Uso diario por persona
create table if not exists public.usage_daily (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  seconds integer not null default 0 check (seconds between 0 and 86400),
  opens integer not null default 0 check (opens >= 0),
  modules jsonb not null default '{}'::jsonb check (pg_column_size(modules) < 2000),
  primary key (user_id, day)
);
alter table public.usage_daily enable row level security;
drop policy if exists "own read" on public.usage_daily;
create policy "own read" on public.usage_daily for select to authenticated using (user_id = auth.uid());
-- sin políticas de escritura: solo se escribe con track_usage (que limita lo que se puede sumar)

create or replace function public.track_usage(p_seconds integer, p_module text, p_open boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  s integer := least(greatest(coalesce(p_seconds, 0), 0), 300);
  m text := case when coalesce(p_module, '') ~ '^[a-z]{1,16}$' then p_module else 'otro' end;
  d date := (now() at time zone 'Europe/Madrid')::date;
begin
  if auth.uid() is null or public.is_blocked() then return; end if;
  insert into public.usage_daily as u (user_id, day, seconds, opens, modules)
  values (auth.uid(), d, s, case when p_open then 1 else 0 end, jsonb_build_object(m, s))
  on conflict (user_id, day) do update set
    seconds = least(u.seconds + s, 86400),
    opens = u.opens + case when p_open then 1 else 0 end,
    modules = jsonb_set(u.modules, array[m], to_jsonb(coalesce((u.modules ->> m)::integer, 0) + s));
end $$;
grant execute on function public.track_usage(integer, text, boolean) to authenticated;

-- 3) Respuestas de la pregunta suave
create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  answer text not null check (char_length(answer) between 1 and 40),
  comment text not null default '' check (char_length(comment) <= 500),
  page text check (page is null or char_length(page) <= 24),
  created_at timestamptz not null default now()
);
alter table public.survey_responses enable row level security;
drop policy if exists "own insert" on public.survey_responses;
create policy "own insert" on public.survey_responses for insert to authenticated
  with check (user_id = auth.uid() and not public.is_blocked());
drop policy if exists "admin read" on public.survey_responses;
create policy "admin read" on public.survey_responses for select to authenticated using (public.is_admin());
drop policy if exists "admin delete" on public.survey_responses;
create policy "admin delete" on public.survey_responses for delete to authenticated using (public.is_admin());

-- 4) Funciones del administrador (cada una comprueba is_admin() en el servidor)
create or replace function public.admin_users()
returns table (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, blocked boolean, is_admin boolean,
               seconds_7d integer, seconds_total integer, days_30 integer, last_day date, rows_count integer)
language plpgsql stable security definer set search_path = public as $$
declare cur date := (now() at time zone 'Europe/Madrid')::date;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select u.id, u.email::text, u.created_at, u.last_sign_in_at,
         exists (select 1 from public.blocked_users b where b.user_id = u.id),
         exists (select 1 from public.app_admins a where lower(a.email) = lower(u.email)),
         coalesce(sum(d.seconds) filter (where d.day >= cur - 6), 0)::integer,
         coalesce(sum(d.seconds), 0)::integer,
         (count(distinct d.day) filter (where d.day >= cur - 29))::integer,
         max(d.day),
         ((select count(*) from public.tasks x where x.user_id = u.id) + (select count(*) from public.habits x where x.user_id = u.id)
          + (select count(*) from public.habit_logs x where x.user_id = u.id) + (select count(*) from public.journal_entries x where x.user_id = u.id)
          + (select count(*) from public.transactions x where x.user_id = u.id) + (select count(*) from public.objectives x where x.user_id = u.id))::integer
  from auth.users u left join public.usage_daily d on d.user_id = u.id
  group by u.id, u.email, u.created_at, u.last_sign_in_at
  order by max(d.day) desc nulls last, u.created_at desc;
end $$;

create or replace function public.admin_usage_daily(p_days integer default 14)
returns table (day date, active_users integer, seconds bigint)
language plpgsql stable security definer set search_path = public as $$
declare cur date := (now() at time zone 'Europe/Madrid')::date; n integer := least(greatest(coalesce(p_days, 14), 1), 90);
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select g::date, (count(d.user_id) filter (where d.seconds > 0))::integer, coalesce(sum(d.seconds), 0)::bigint
  from generate_series(cur - (n - 1), cur, interval '1 day') g left join public.usage_daily d on d.day = g::date
  group by g order by g;
end $$;

create or replace function public.admin_module_usage(p_days integer default 14)
returns table (module text, seconds bigint, users integer)
language plpgsql stable security definer set search_path = public as $$
declare cur date := (now() at time zone 'Europe/Madrid')::date; n integer := least(greatest(coalesce(p_days, 14), 1), 90);
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select e.key, sum(e.value::integer)::bigint, (count(distinct d.user_id))::integer
  from public.usage_daily d, jsonb_each_text(d.modules) e
  where d.day >= cur - (n - 1)
  group by e.key order by 2 desc;
end $$;

create or replace function public.admin_set_blocked(p_user uuid, p_blocked boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'No puedes pausarte a ti mismo.'; end if;
  if exists (select 1 from auth.users u join public.app_admins a on lower(a.email) = lower(u.email) where u.id = p_user) then
    raise exception 'No se puede pausar a un administrador.';
  end if;
  if p_blocked then
    insert into public.blocked_users (user_id, reason) values (p_user, left(coalesce(p_reason, ''), 200))
    on conflict (user_id) do update set reason = excluded.reason, blocked_at = now();
  else
    delete from public.blocked_users where user_id = p_user;
  end if;
end $$;

create or replace function public.admin_db_size()
returns bigint language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return pg_database_size(current_database());
end $$;

revoke all on function public.admin_users(), public.admin_usage_daily(integer), public.admin_module_usage(integer),
  public.admin_set_blocked(uuid, boolean, text), public.admin_db_size() from public, anon;
grant execute on function public.admin_users(), public.admin_usage_daily(integer), public.admin_module_usage(integer),
  public.admin_set_blocked(uuid, boolean, text), public.admin_db_size() to authenticated;

-- 5) Ajustes globales del administrador (pregunta suave: activada, cada cuántos días, tras cuántos días de uso…)
create table if not exists public.app_settings (
  key text primary key check (char_length(key) <= 40),
  value jsonb not null default '{}'::jsonb check (pg_column_size(value) < 4000),
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "all read" on public.app_settings;
create policy "all read" on public.app_settings for select to authenticated using (true);
drop policy if exists "admin write" on public.app_settings;
create policy "admin write" on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
