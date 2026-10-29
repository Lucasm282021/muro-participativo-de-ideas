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
  v_activity record;
  v_ideas_json jsonb;
  v_count integer;
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

  -- 3. Verificación de existencia y titularidad de la actividad
  -- Garantiza que solo la persona organizadora propietaria acceda a los datos de la actividad
  select id, public_code, title, question, status, created_at
  into v_activity
  from public.activities
  where id = target_activity_id
    and owner_id = v_user_id;

  if not found then
    raise exception 'Actividad no encontrada o acceso no autorizado' using errcode = 'P0002';
  end if;

  -- 4. Conteo y recuperación de ideas en una única pasada MVCC (hasta 5.001 registros)
  -- Excluye estrictamente cualquier dato personal (sin autores, emails ni participantes)
  with candidate_ideas as (
    select
      i.id,
      i.content,
      i.status,
      i.created_at,
      i.published_at
    from public.ideas as i
    where i.activity_id = target_activity_id
      and (export_scope = 'all' or i.status = 'published')
    order by i.created_at asc, i.id asc
    limit 5001
  )
  select
    count(*),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'content', content,
          'status', status,
          'created_at', created_at,
          'published_at', published_at
        )
      ),
      '[]'::jsonb
    )
  into v_count, v_ideas_json
  from candidate_ideas;

  -- 5. Control de desbordamiento de 5.000 ideas
  if v_count > v_limit then
    -- Obtener conteo exacto de la colección completa si excede el límite
    select count(*) into v_count
    from public.ideas
    where activity_id = target_activity_id
      and (export_scope = 'all' or status = 'published');

    return jsonb_build_object(
      'error', 'payload_too_large',
      'total', v_count,
      'limit', v_limit
    );
  end if;

  -- 6. Retorno de snapshot atómico consistente
  return jsonb_build_object(
    'activity', jsonb_build_object(
      'id', v_activity.id,
      'public_code', v_activity.public_code,
      'title', v_activity.title,
      'question', v_activity.question,
      'status', v_activity.status,
      'created_at', v_activity.created_at
    ),
    'ideas', v_ideas_json,
    'total', v_count
  );
end;
$$;

-- Restricción estricta de permisos
revoke all on function public.export_activity_ideas(uuid, text) from public;
revoke all on function public.export_activity_ideas(uuid, text) from anon;
grant execute on function public.export_activity_ideas(uuid, text) to authenticated;
