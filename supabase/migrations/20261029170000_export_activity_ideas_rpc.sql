-- Migration: 20261029170000_export_activity_ideas_rpc.sql
-- Propuesta técnica: Función RPC atómica para exportación de resultados de actividad (CSV/HTML).
-- NOTA OBLIGATORIA: Archivo preparado y versionado para revisión. NO ejecutar ni desplegar en entornos compartidos o producción sin autorización explícita e independiente.

create or replace function public.export_activity_ideas(
  target_activity_id uuid,
  export_scope text default 'published'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_result jsonb;
  v_count integer;
  v_total_count integer;
  v_limit constant integer := 5000;
begin
  -- 1. Autenticación obligatoria
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  -- 2. Validación de alcance de exportación
  if export_scope not in ('published', 'all') then
    raise exception 'Alcance de exportación inválido' using errcode = '22023';
  end if;

  -- 3. Lectura consistente bajo un único snapshot MVCC en una sola sentencia SQL
  -- Vincula la verificación de titularidad y la recuperación ordenada de ideas en el
  -- mismo instante transaccional de lectura (point-in-time snapshot).
  with target_act as (
    select
      a.id,
      a.public_code,
      a.title,
      a.question,
      a.status,
      a.created_at
    from public.activities as a
    where a.id = target_activity_id
      and a.owner_id = v_user_id
  ),
  candidate_ideas as (
    select
      i.id,
      i.content,
      i.status,
      i.created_at,
      i.published_at
    from public.ideas as i
    inner join target_act as a on a.id = i.activity_id
    where (export_scope = 'all' or i.status = 'published')
    order by i.created_at asc, i.id asc
    limit 5001
  )
  select
    case
      -- Si la actividad no existe o pertenece a otro usuario
      when not exists (select 1 from target_act) then null
      else jsonb_build_object(
        'activity', (
          select jsonb_build_object(
            'id', a.id,
            'public_code', a.public_code,
            'title', a.title,
            'question', a.question,
            'status', a.status,
            'created_at', a.created_at
          )
          from target_act as a
        ),
        'ideas_count', (select count(*) from candidate_ideas),
        'ideas', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'content', c.content,
                'status', c.status,
                'created_at', c.created_at,
                'published_at', c.published_at
              )
              order by c.created_at asc, c.id asc
            ),
            '[]'::jsonb
          )
          from candidate_ideas as c
        )
      )
    end
  into v_result;

  -- 4. Si la actividad no existe o el usuario no es el titular, denegar con P0002
  if v_result is null then
    raise exception 'Actividad no encontrada o acceso no autorizado' using errcode = 'P0002';
  end if;

  v_count := (v_result->>'ideas_count')::integer;

  -- 5. Control de desbordamiento de 5.000 ideas
  if v_count > v_limit then
    select count(*)
    into v_total_count
    from public.ideas
    where activity_id = target_activity_id
      and (export_scope = 'all' or status = 'published');

    return jsonb_build_object(
      'error', 'payload_too_large',
      'total', v_total_count,
      'limit', v_limit
    );
  end if;

  -- 6. Retorno de snapshot completo sin datos personales
  return jsonb_build_object(
    'activity', v_result->'activity',
    'ideas', v_result->'ideas',
    'total', v_count
  );
end;
$$;

-- Restricción estricta de permisos
revoke all on function public.export_activity_ideas(uuid, text) from public;
revoke all on function public.export_activity_ideas(uuid, text) from anon;
grant execute on function public.export_activity_ideas(uuid, text) to authenticated;
