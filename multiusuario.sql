-- Varias personas, un administrador.
--  * Cada persona solo ve y edita SUS filas (user_id = auth.uid()).
--  * Solo el administrador puede usar CloudSpace Intelligence (el servidor lo exige, no solo la pantalla).
-- 1) Cambia TU_CORREO@ejemplo.com por el correo del administrador (no lo guardes en el repositorio).
-- 2) Ejecuta antes migracion-v2 ... migracion-v10 y después este archivo; luego migracion-v11.sql (apartado Administración). Puedes repetirlo sin problema.
-- 3) Sustituye a single-user.sql: este archivo deshace la restricción a un solo correo.

-- Administradores
create table if not exists public.app_admins (email text primary key);
alter table public.app_admins enable row level security; -- sin políticas: nadie puede leerla ni editarla desde la app
insert into public.app_admins (email) values (lower('TU_CORREO@ejemplo.com')) on conflict do nothing;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
grant execute on function public.is_admin() to authenticated;

-- Tablas normales: cada persona solo sus filas
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
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('drop policy if exists "solo yo" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Intelligence: solo administrador
do $$
begin
  if to_regclass('public.intelligence_settings') is not null then
    drop policy if exists "own rows" on public.intelligence_settings;
    drop policy if exists "solo yo" on public.intelligence_settings;
    create policy "own rows" on public.intelligence_settings for all to authenticated
      using (user_id = auth.uid() and public.is_admin()) with check (user_id = auth.uid() and public.is_admin());
  end if;
  if to_regclass('public.intelligence_items') is not null then
    drop policy if exists "own read" on public.intelligence_items;
    drop policy if exists "own delete" on public.intelligence_items;
    drop policy if exists "own insert while active" on public.intelligence_items;
    drop policy if exists "own update while active" on public.intelligence_items;
    drop policy if exists "solo yo leer" on public.intelligence_items;
    drop policy if exists "solo yo borrar" on public.intelligence_items;
    drop policy if exists "solo yo crear" on public.intelligence_items;
    drop policy if exists "solo yo editar" on public.intelligence_items;
    create policy "own read" on public.intelligence_items for select to authenticated using (user_id = auth.uid() and public.is_admin());
    create policy "own delete" on public.intelligence_items for delete to authenticated using (user_id = auth.uid() and public.is_admin());
    create policy "own insert while active" on public.intelligence_items for insert to authenticated
      with check (user_id = auth.uid() and public.is_admin() and public.intelligence_active());
    create policy "own update while active" on public.intelligence_items for update to authenticated
      using (user_id = auth.uid() and public.is_admin()) with check (user_id = auth.uid() and public.is_admin() and public.intelligence_active());
  end if;
end $$;
