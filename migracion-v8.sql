-- CloudSpace · migración v8: nota opcional en los movimientos
-- Segura y no destructiva: solo añade una columna opcional. Los movimientos existentes quedan igual (note = null).
-- Se puede ejecutar más de una vez. Pégala en Supabase > SQL Editor.

alter table public.transactions
  add column if not exists note text check (note is null or char_length(note) <= 300);

-- Las políticas RLS de "transactions" no cambian: la columna nueva queda cubierta por las mismas reglas de "solo tus filas".
