-- Deja la base de datos accesible SOLO para un correo.
-- 1) Pega esto en Supabase > SQL Editor y cambia soymatheus.lemos@gmail.com ahí
--    (no guardes tu correo en este archivo si vas a subirlo a GitHub).
-- 2) Usa el mismo correo con el que creaste tu cuenta en la app.
-- 3) Ejecuta antes migracion-v2.sql, migracion-v3.sql, migracion-v4.sql, migracion-v5.sql migracion-v6.sql … migracion-v9.sql (crean las tablas) y después este archivo.
--    Puedes repetirlo cuando añadas tablas nuevas.
-- 4) Pulsa Run.

do $$
declare
  t text;
  allowed text := lower('soymatheus.lemos@gmail.com');
begin
  foreach t in array array[
    'tasks', 'habits', 'habit_logs', 'timer', 'timer_sessions',
    'task_lists', 'task_steps', 'routines', 'routine_steps',
    'journal_entries', 'transactions', 'budgets', 'savings_goals', 'ideas',
    'intelligence_settings', 'subscriptions', 'user_prefs'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if; -- tablas de migraciones que aún no has ejecutado
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('drop policy if exists "solo yo" on public.%I', t);
    execute format(
      'create policy "solo yo" on public.%I for all to authenticated
         using (user_id = auth.uid() and lower(auth.jwt() ->> ''email'') = %L)
         with check (user_id = auth.uid() and lower(auth.jwt() ->> ''email'') = %L)',
      t, allowed, allowed
    );
  end loop;
end $$;

-- CloudSpace Intelligence: recomendaciones importadas. Misma restricción de correo, pero conservando la
-- comprobación de expiración en el servidor (crear/modificar solo mientras intelligence_active() sea true).
do $$
declare allowed text := lower('soymatheus.lemos@gmail.com');
begin
  if to_regclass('public.intelligence_items') is null then return; end if;
  drop policy if exists "own read" on public.intelligence_items;
  drop policy if exists "own delete" on public.intelligence_items;
  drop policy if exists "own insert while active" on public.intelligence_items;
  drop policy if exists "own update while active" on public.intelligence_items;
  drop policy if exists "solo yo" on public.intelligence_items;
  drop policy if exists "solo yo leer" on public.intelligence_items;
  drop policy if exists "solo yo borrar" on public.intelligence_items;
  drop policy if exists "solo yo crear" on public.intelligence_items;
  drop policy if exists "solo yo editar" on public.intelligence_items;
  execute format('create policy "solo yo leer" on public.intelligence_items for select to authenticated using (user_id = auth.uid() and lower(auth.jwt() ->> ''email'') = %L)', allowed);
  execute format('create policy "solo yo borrar" on public.intelligence_items for delete to authenticated using (user_id = auth.uid() and lower(auth.jwt() ->> ''email'') = %L)', allowed);
  execute format('create policy "solo yo crear" on public.intelligence_items for insert to authenticated with check (user_id = auth.uid() and lower(auth.jwt() ->> ''email'') = %L and public.intelligence_active())', allowed);
  execute format('create policy "solo yo editar" on public.intelligence_items for update to authenticated using (user_id = auth.uid() and lower(auth.jwt() ->> ''email'') = %L) with check (user_id = auth.uid() and lower(auth.jwt() ->> ''email'') = %L and public.intelligence_active())', allowed, allowed);
end $$;
