-- CloudSpace · migración v6: suscripciones (Finanzas)
-- Pega todo esto en Supabase > SQL Editor y pulsa Run. Se puede repetir sin problema.
-- Después, si usas el acceso "solo yo", vuelve a ejecutar tu single-user.sql (ya incluye 'subscriptions').

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  amount numeric(12, 2) not null check (amount > 0),
  cycle text not null default 'monthly' check (cycle in ('weekly', 'monthly', 'quarterly', 'yearly')),
  category text not null default 'Suscripciones' check (char_length(category) between 1 and 40),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  next_charge date,
  started_on date,
  ended_on date,
  notes text not null default '' check (char_length(notes) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists subscriptions_user_status_idx on public.subscriptions (user_id, status);

alter table public.subscriptions enable row level security;

drop policy if exists "own rows" on public.subscriptions;
create policy "own rows" on public.subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
