-- Deja la base de datos accesible SOLO para un correo.
-- 1) Pega esto en Supabase > SQL Editor y cambia TU_CORREO@ejemplo.com ahi
--    (no guardes tu correo en este archivo si vas a subirlo a GitHub).
-- 2) Usa el mismo correo con el que creaste tu cuenta en la app.
-- 3) Pulsa Run.

do $$
declare
  t text;
  allowed text := lower('TU_CORREO@ejemplo.com');
begin
  foreach t in array array['tasks','habits','habit_logs','timer','timer_sessions'] loop
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
