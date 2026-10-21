-- ==============================================================================
-- Migración: 20261021140000_audit_cascade_counts_v2.sql
-- Propósito: Ampliar el payload de `activity_delete_cascade` con las cantidades
--            reales de filas eliminadas en cada tabla hija, de forma EXACTA y
--            sin doble conteo, sin asumir ningún orden de cascada entre tablas.
-- Resuelve: PEND-01 (contrato del evento de cascada).
-- Estado: ADITIVA, IDEMPOTENTE, REVERSIBLE. No edita migraciones históricas.
--
-- ------------------------------------------------------------------------------
-- ANÁLISIS TÉCNICO DEL MECANISMO DE CONTEO (justificación obligatoria)
-- ------------------------------------------------------------------------------
-- Topología de claves foráneas hacia `activities` (migración 1):
--   activities 1──N participants          (participants.activity_id → activities.id)
--   activities 1──N ideas                 (ideas.activity_id        → activities.id)
--   ideas      1──N idea_authors          (idea_authors.(activity_id,idea_id))
--   participants 1──N idea_authors        (idea_authors.(activity_id,participant_id))
--
-- RESTRICCIÓN REAL descubierta por evidencia (P1-R97):
--   idea_authors.idea_id es PRIMARY KEY => cada idea tiene EXACTAMENTE un autor.
--
-- POR QUÉ SE DESCARTA EL CONTEO INCREMENTAL POR DISPARADOR
--   La evidencia empírica (traza de triggers en una base aislada) demostró que
--   PostgreSQL ejecuta la cascada de SEGUNDO NIVEL (activities → ideas →
--   idea_authors) DESPUÉS del `AFTER DELETE` de la fila padre. En la traza real
--   el orden observado fue:
--       1) activities AFTER DELETE   (momento en que la migración 7 purga el contexto)
--       2) idea_authors BEFORE DELETE
--   Un contador incremental en `idea_authors` lee entonces un contexto ya
--   purgado y NO contabiliza. (El contador de `participants`, al ser cascada de
--   primer nivel, sí funcionó — pero eso es dependiente del orden, no una garantía.)
--   Conclusión: los contadores incrementales por disparador NO son fiables y se
--   descartan expresamente por no garantizar exactitud.
--
-- MECANISMO ADOPTADO (independiente del orden, sin inferencias)
--   Los conteos se capturan en el `BEFORE DELETE` de la fila PADRE
--   (`fn_audit_activity_before_delete`), instante en el que la actividad y TODOS
--   sus hijos aún existen físicamente en la transacción. Allí se cuentan las
--   filas reales con SELECT COUNT(*):
--       ideas        : count(*) where activity_id = old.id
--       participants : count(*) where activity_id = old.id
--       idea_authors : count(*) where activity_id = old.id
--   Son conteos de filas realmente presentes y a punto de eliminarse por la
--   cascada. No dependen del orden de procesamiento de tablas hijas, no hay
--   acumuladores compartidos y no puede haber doble conteo: cada cifra procede de
--   una única consulta de conteo sobre una única tabla.
--
--   El `AFTER DELETE` de la fila padre únicamente EMITE el evento leyendo esos
--   valores ya calculados. Ya no requiere purgar un contexto transaccional para
--   los conteos, pero SE CONSERVA `audit_cascade_context` para compatibilidad con
--   la migración 7 y para mantener la discriminación de borrados individuales de
--   ideas (fn_audit_idea_delete la consulta y actualiza).
--
-- SEMÁNTICA DEL PAYLOAD v2 (activity_delete_cascade):
--   ideas_deleted_count          int  filas eliminadas de ideas
--   participants_deleted_count   int  filas eliminadas de participants
--   idea_authors_deleted_count   int  filas eliminadas de idea_authors
--                                     (se cuentan FILAS, no personas únicas)
--   contract_version             int  = 2
-- Los eventos históricos carecen de `contract_version`; los consumidores deben
-- tratarlos como versión 1 (`ideas_deleted_count` únicamente).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. AMPLIACIÓN ADITIVA DE LA TABLA DE CONTEXTO TRANSACCIONAL (C5)
-- ------------------------------------------------------------------------------
alter table public.audit_cascade_context
  add column if not exists participants_count integer not null default 0;

alter table public.audit_cascade_context
  add column if not exists idea_authors_count integer not null default 0;

-- Se refuerza el blindaje ya establecido en la migración 7 (idempotente).
alter table public.audit_cascade_context enable row level security;
revoke all on table public.audit_cascade_context from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. CAPTURA DE CONTEOS EN EL BEFORE DELETE DEL PADRE (independiente del orden)
-- ------------------------------------------------------------------------------
-- Se reemplaza la versión de la migración 7 añadiendo el conteo de hijos. La
-- inserción del contexto se mantiene para conservar la discriminación de ideas.
create or replace function public.fn_audit_activity_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ideas_count integer;
  v_participants_count integer;
  v_idea_authors_count integer;
begin
  -- Conteo exacto de hijos AÚN PRESENTES. Este es el único punto del ciclo de
  -- vida en el que la actividad y todos sus descendientes coexisten.
  select count(*) into v_ideas_count
    from public.ideas where activity_id = old.id;

  select count(*) into v_participants_count
    from public.participants where activity_id = old.id;

  select count(*) into v_idea_authors_count
    from public.idea_authors where activity_id = old.id;

  insert into public.audit_cascade_context
    (activity_id, tx_id, ideas_count, participants_count, idea_authors_count)
  values (old.id, txid_current(), v_ideas_count, v_participants_count, v_idea_authors_count)
  on conflict (activity_id, tx_id) do update
    set ideas_count = excluded.ideas_count,
        participants_count = excluded.participants_count,
        idea_authors_count = excluded.idea_authors_count;

  return old;
end;
$$;

-- ------------------------------------------------------------------------------
-- 3. DISCRIMINACIÓN DE BORADOS INDIVIDUALES DE IDEAS (sin incremento de conteo)
-- ------------------------------------------------------------------------------
-- La migración 7 incrementaba `ideas_count` aquí y purgaba el contexto en el
-- AFTER DELETE del padre. Con el nuevo mecanismo el conteo ya viene fijado por
-- `fn_audit_activity_before_delete`, por lo que este disparador SOLO decide si la
-- idea se borra individualmente (sin contexto) o como parte de una cascada
-- (con contexto), SIN alterar ningún contador.
create or replace function public.fn_audit_idea_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_actor_id uuid;
  v_resolved_actor_type varchar(30);
  v_is_cascade boolean := false;
begin
  -- ¿Existe contexto de cascada para la actividad en esta transacción?
  select true into v_is_cascade
    from public.audit_cascade_context
   where activity_id = old.activity_id
     and tx_id = txid_current()
   limit 1;

  if v_is_cascade is null then
    v_is_cascade := false;
  end if;

  -- Si NO está en cascada, se trata de una eliminación intencional individual.
  if not v_is_cascade then
    v_current_actor_id := (select auth.uid());
    if v_current_actor_id is not null then
      v_resolved_actor_type := 'authenticated_user';
    else
      v_resolved_actor_type := 'system_or_internal';
    end if;

    insert into public.audit_logs (actor_id, actor_type, action, target_table, target_id, payload)
    values (
      v_current_actor_id,
      v_resolved_actor_type,
      'idea_delete_individual',
      'ideas',
      old.id,
      jsonb_build_object(
        'activity_id', old.activity_id,
        'status', old.status,
        'published_at', old.published_at,
        'content_length', char_length(old.content)
      )
    );
  end if;

  return old;
end;
$$;

-- ------------------------------------------------------------------------------
-- 4. EMISIÓN DEL EVENTO CONSOLIDADO CON EL PAYLOAD v2
-- ------------------------------------------------------------------------------
-- El AFTER DELETE del padre SOLO emite: lee los conteos ya fijados por el
-- BEFORE DELETE y purga el contexto. Preserva intacto el hard-fail de auditoría:
-- cualquier error al insertar en public.audit_logs aborta la transacción completa.
create or replace function public.fn_audit_activity_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_actor_id uuid;
  v_resolved_actor_type varchar(30);
  v_ideas_count integer := 0;
  v_participants_count integer := 0;
  v_idea_authors_count integer := 0;
begin
  v_current_actor_id := (select auth.uid());
  if v_current_actor_id is not null then
    v_resolved_actor_type := 'authenticated_user';
  else
    v_resolved_actor_type := 'system_or_internal';
  end if;

  -- Extraer los conteos ya calculados y purgar la fila de contexto de forma atómica.
  delete from public.audit_cascade_context
  where activity_id = old.id
    and tx_id = txid_current()
  returning ideas_count, participants_count, idea_authors_count
  into v_ideas_count, v_participants_count, v_idea_authors_count;

  if v_ideas_count is null then
    v_ideas_count := 0;
  end if;
  if v_participants_count is null then
    v_participants_count := 0;
  end if;
  if v_idea_authors_count is null then
    v_idea_authors_count := 0;
  end if;

  if v_ideas_count > 0 then
    -- Borrado con propagación en cascada sobre entidades subordinadas.
    insert into public.audit_logs (actor_id, actor_type, action, target_table, target_id, payload)
    values (
      v_current_actor_id,
      v_resolved_actor_type,
      'activity_delete_cascade',
      'activities',
      old.id,
      jsonb_build_object(
        'public_code', old.public_code,
        'title', old.title,
        'owner_id', old.owner_id,
        'status', old.status,
        'ideas_deleted_count', v_ideas_count,
        'participants_deleted_count', v_participants_count,
        'idea_authors_deleted_count', v_idea_authors_count,
        'contract_version', 2,
        'opened_at', old.opened_at,
        'closed_at', old.closed_at
      )
    );
  else
    -- Borrado de actividad sin ideas asociadas: comportamiento actual preservado.
    insert into public.audit_logs (actor_id, actor_type, action, target_table, target_id, payload)
    values (
      v_current_actor_id,
      v_resolved_actor_type,
      'activity_delete',
      'activities',
      old.id,
      jsonb_build_object(
        'public_code', old.public_code,
        'title', old.title,
        'owner_id', old.owner_id,
        'status', old.status,
        'ideas_deleted_count', 0,
        'participants_deleted_count', v_participants_count,
        'idea_authors_deleted_count', v_idea_authors_count,
        'contract_version', 2,
        'opened_at', old.opened_at,
        'closed_at', old.closed_at
      )
    );
  end if;

  return old;
end;
$$;

-- ------------------------------------------------------------------------------
-- 5. REVOCACIÓN PREVENTIVA (coherente con la migración 7, sección 8)
-- ------------------------------------------------------------------------------
revoke all on function public.fn_audit_activity_before_delete() from public, anon, authenticated;
revoke all on function public.fn_audit_activity_after_delete() from public, anon, authenticated;
revoke all on function public.fn_audit_idea_delete() from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 6. ESTRATEGIA DE REVERSIÓN (documentada, NO ejecutada)
-- ------------------------------------------------------------------------------
-- Para revertir esta migración sin tocar el historial, se restauran las tres
-- funciones reemplazadas re-aplicando la migración 7 (que las recrea con
-- `create or replace`) y se eliminan las columnas añadidas:
--   -- (volver a aplicar supabase/migrations/20261020130000_administrative_audit_hardening.sql)
--   alter table public.audit_cascade_context drop column if exists idea_authors_count;
--   alter table public.audit_cascade_context drop column if exists participants_count;
-- ==============================================================================
