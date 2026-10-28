-- CloudSpace · migración v10: objetivos e hitos (sección «Plan»)
-- Segura y no destructiva: crea UNA tabla nueva. No toca ninguna tabla ni dato existente.
-- Se puede ejecutar más de una vez. Pégala entera en Supabase > SQL Editor y pulsa Run.
--
-- Un objetivo es un resultado que quieres conseguir, dividido en hitos manejables.
--   milestones → lista de hitos [{id, title, done, date}]; el progreso se mide por hitos conseguidos
--   task_ids / habit_ids → ids de tareas y hábitos que YA existen (se enlazan, no se copian)
-- Si NO ejecutas este archivo, la app sigue funcionando; solo avisa de que falta la tabla al guardar un objetivo.

create table if not exists public.objectives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  why text not null default '' check (char_length(why) <= 500),
  due_date date,
  status text not null default 'active' check (status in ('active', 'paused', 'done')),
  milestones jsonb not null default '[]'::jsonb check (pg_column_size(milestones) < 20000),
  task_ids jsonb not null default '[]'::jsonb check (pg_column_size(task_ids) < 10000),
  habit_ids jsonb not null default '[]'::jsonb check (pg_column_size(habit_ids) < 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists objectives_user_idx on public.objectives (user_id, created_at);

alter table public.objectives enable row level security;

drop policy if exists "own rows" on public.objectives;
create policy "own rows" on public.objectives for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Para tiempo real (cambios entre dispositivos), si tu publicación lo permite:
do $$ begin
  alter publication supabase_realtime add table public.objectives;
exception when others then null; end $$;

-- Si usas single-user.sql o multiusuario.sql, vuelve a ejecutarlo después de este archivo para que cubra también esta tabla.
