-- CloudSpace · migración v7: estado "En revisión" para el tablero de tareas
-- Pega todo en Supabase > SQL Editor y pulsa Run. Se puede repetir sin problema.
-- Conserva todos los datos: solo amplía los estados permitidos (todo, doing, review, done).

alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks
  add constraint tasks_status_check check (status in ('todo', 'doing', 'review', 'done'));
