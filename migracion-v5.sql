-- Cloudspace Intelligence (v5): interruptor con fecha de expiración y recomendaciones importadas.
--
-- Qué crea y para qué:
--   * intelligence_settings: UNA fila por usuario con intelligence_enabled, intelligence_expires_at e intelligence_mode.
--     La fecha de expiración la fijas tú a mano; la app NO comprueba tu suscripción de Claude.
--   * intelligence_items: las recomendaciones que decidas importar desde el análisis de Claude (solo campos
--     interpretados; no se guarda el informe ni la respuesta completa). Puedes borrarlas desde la app.
--   * intelligence_active(): función que dice si Intelligence está activa AHORA según tu fila de ajustes.
--     Las políticas de intelligence_items la usan: pasada la fecha (o desactivada), el servidor rechaza
--     crear o modificar recomendaciones. Leer y borrar sigue permitido para conservar tus registros.
-- No toca ninguna tabla existente. Si lo repites no pasa nada.
-- Orden: ... -> migracion-v4.sql -> este archivo -> single-user.sql (con tu correo).

create table if not exists public.intelligence_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  intelligence_enabled boolean not null default true,
  intelligence_expires_at timestamptz,
  intelligence_mode text not null default 'hybrid' check (intelligence_mode in ('rules', 'hybrid')),
  updated_at timestamptz not null default now()
);

create table if not exists public.intelligence_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  category text not null default 'otros',
  problem text not null default '',
  action text not null default '',
  priority smallint not null default 4 check (priority between 1 and 4),
  suggested_date date,
  related_goal text not null default '',
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists intelligence_items_user_idx on public.intelligence_items (user_id, created_at desc);

-- Sin fila de ajustes se considera activa (igual que la app). Con fila: activa y sin fecha vencida.
create or replace function public.intelligence_active()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.intelligence_enabled and (s.intelligence_expires_at is null or s.intelligence_expires_at > now())
       from public.intelligence_settings s where s.user_id = auth.uid()),
    true)
$$;
grant execute on function public.intelligence_active() to authenticated;

alter table public.intelligence_settings enable row level security;
alter table public.intelligence_items enable row level security;

drop policy if exists "own rows" on public.intelligence_settings;
create policy "own rows" on public.intelligence_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own rows" on public.intelligence_items;
drop policy if exists "own read" on public.intelligence_items;
drop policy if exists "own delete" on public.intelligence_items;
drop policy if exists "own insert while active" on public.intelligence_items;
drop policy if exists "own update while active" on public.intelligence_items;
create policy "own read" on public.intelligence_items for select to authenticated using (user_id = auth.uid());
create policy "own delete" on public.intelligence_items for delete to authenticated using (user_id = auth.uid());
create policy "own insert while active" on public.intelligence_items for insert to authenticated
  with check (user_id = auth.uid() and public.intelligence_active());
create policy "own update while active" on public.intelligence_items for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.intelligence_active());
