-- Feedback de invitados y usuarios.
-- Ejecútalo UNA vez en Supabase > SQL Editor (cambia TU_CORREO@ejemplo.com por el tuyo, el mismo de single-user.sql).
-- Cualquiera puede ENVIAR un comentario (rol anon), pero solo tu cuenta puede LEERLOS.
-- No guardes tu correo en este archivo si lo subes a GitHub.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  rating smallint check (rating between 1 and 5),
  message text not null check (char_length(message) between 1 and 1000),
  contact text check (contact is null or char_length(contact) <= 120),
  page text check (page is null or char_length(page) <= 30),
  guest boolean not null default false,
  user_agent text check (user_agent is null or char_length(user_agent) <= 200)
);

alter table public.feedback enable row level security;

drop policy if exists "enviar feedback" on public.feedback;
create policy "enviar feedback" on public.feedback
  for insert to anon, authenticated
  with check (char_length(message) between 1 and 1000);

drop policy if exists "leer feedback solo yo" on public.feedback;
create policy "leer feedback solo yo" on public.feedback
  for select to authenticated
  using (lower(auth.jwt() ->> 'email') = lower('TU_CORREO@ejemplo.com'));

drop policy if exists "borrar feedback solo yo" on public.feedback;
create policy "borrar feedback solo yo" on public.feedback
  for delete to authenticated
  using (lower(auth.jwt() ->> 'email') = lower('TU_CORREO@ejemplo.com'));

create index if not exists feedback_created_idx on public.feedback (created_at desc);
