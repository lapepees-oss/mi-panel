-- CloudSpace · mantenimiento de Supabase (solo lectura salvo el bloque comentado del final)
-- Pega en Supabase > SQL Editor. La primera consulta no modifica nada.

-- 1) Qué tablas ocupan más espacio y cuántas filas tienen
select
  c.relname as tabla,
  pg_size_pretty(pg_total_relation_size(c.oid)) as tamano_total,
  c.reltuples::bigint as filas_aprox
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;

-- 2) Tamaño total de la base de datos
select pg_size_pretty(pg_database_size(current_database())) as tamano_base_de_datos;

-- 3) (OPCIONAL, BORRA DATOS) Limpiar sesiones del cronómetro de hace más de 2 años.
--    Exporta antes una copia de seguridad desde la app. Quita los "--" de la línea siguiente para ejecutarlo.
-- delete from public.timer_sessions where created_at < now() - interval '2 years';
