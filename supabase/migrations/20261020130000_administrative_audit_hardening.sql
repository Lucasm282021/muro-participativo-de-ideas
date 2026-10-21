-- ==============================================================================
-- Migration: 20261020130000_administrative_audit_hardening.sql
-- Propósito: Auditoría administrativa integral, trazabilidad de roles y discriminación
--            estricta de borrados en cascada mediante contexto transaccional C5.
-- Hallazgos resueltos: H-16, H-17, H-18, H-19, H-22, H-11 / H-15.
-- Estado: ADITIVA, IDEMPOTENTE, REVERSIBLE.
-- NOTA: Archivo redactado exclusivamente para revisión técnica estática.
--       NO aplicar ni ejecutar sin autorización explícita independiente.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABLA DE CONTEXTO TRANSACCIONAL EFÍMERO PARA CASCADAS (C5)
-- ------------------------------------------------------------------------------
-- Registra temporalmente las actividades en proceso de borrado dentro de la
-- transacción actual (txid_current()) para distinguir borrados individuales de
-- eliminaciones en cascada sin generar registros individuales duplicados.
create table if not exists public.audit_cascade_context (
  activity_id uuid not null,
  tx_id bigint not null,
  ideas_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint audit_cascade_context_pkey primary key (activity_id, tx_id)
);

-- Blindaje RLS estricto: inaccesible para clientes de aplicación
alter table public.audit_cascade_context enable row level security;
revoke all on table public.audit_cascade_context from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. DISPARADORES DE ACTIVIDADES: BORRADO (INICIALIZACIÓN Y EMISIÓN C5)
-- ------------------------------------------------------------------------------

-- Función BEFORE DELETE: inicializa el contador de contexto en la transacción
create or replace function public.fn_audit_activity_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_cascade_context (activity_id, tx_id, ideas_count)
  values (old.id, txid_current(), 0)
  on conflict (activity_id, tx_id) do nothing;
  return old;
end;
$$;

-- Función AFTER DELETE: emite el evento de auditoría consolidado y purga el contexto
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
begin
  v_current_actor_id := (select auth.uid());
  if v_current_actor_id is not null then
    v_resolved_actor_type := 'authenticated_user';
  else
    v_resolved_actor_type := 'system_or_internal';
  end if;

  -- Extraer el conteo acumulado y eliminar la fila de contexto de forma atómica
  delete from public.audit_cascade_context
  where activity_id = old.id
    and tx_id = txid_current()
  returning ideas_count into v_ideas_count;

  if v_ideas_count is null then
    v_ideas_count := 0;
  end if;

  if v_ideas_count > 0 then
    -- Borrado con propagación en cascada sobre ideas subordinadas
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
        'opened_at', old.opened_at,
        'closed_at', old.closed_at
      )
    );
  else
    -- Borrado de actividad sin ideas asociadas
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
        'opened_at', old.opened_at,
        'closed_at', old.closed_at
      )
    );
  end if;

  return old;
end;
$$;

-- ------------------------------------------------------------------------------
-- 3. DISPARADORES DE IDEAS: BORRADO (DISCRIMINACIÓN C5)
-- ------------------------------------------------------------------------------

-- Función BEFORE DELETE: discrimina si la idea se elimina individualmente o por cascada
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
  -- Intentar actualizar el contador de contexto en la transacción activa
  update public.audit_cascade_context
  set ideas_count = ideas_count + 1
  where activity_id = old.activity_id
    and tx_id = txid_current();

  if found then
    v_is_cascade := true;
  end if;

  -- Si NO está en cascada, se trata de una eliminación intencional individual
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
-- 4. DISPARADORES DE IDEAS: CREACIÓN Y MODERACIÓN (H-16 / H-22)
-- ------------------------------------------------------------------------------

-- Función AFTER INSERT: audita la creación de ideas preservando la privacidad del contenido
create or replace function public.fn_audit_idea_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_actor_id uuid;
  v_resolved_actor_type varchar(30);
begin
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
    'idea_created',
    'ideas',
    new.id,
    jsonb_build_object(
      'activity_id', new.activity_id,
      'initial_status', new.status,
      'created_at', new.created_at,
      'published_at', new.published_at,
      'content_length', char_length(new.content)
    )
  );

  return new;
end;
$$;

-- Función AFTER UPDATE: audita moderación de estado de ideas
create or replace function public.fn_audit_idea_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_actor_id uuid;
  v_resolved_actor_type varchar(30);
begin
  if (new.status is distinct from old.status) then
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
      'idea_moderate_status',
      'ideas',
      new.id,
      jsonb_build_object(
        'activity_id', new.activity_id,
        'old_status', old.status,
        'new_status', new.status,
        'old_published_at', old.published_at,
        'new_published_at', new.published_at,
        'content_length', char_length(new.content)
      )
    );
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------------------------
-- 5. DISPARADORES DE ACTIVIDADES: ACTUALIZACIÓN (H-19 / H-22)
-- ------------------------------------------------------------------------------

-- Función AFTER UPDATE: audita cambios con semántica diferenciada estricta
create or replace function public.fn_audit_activity_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_actor_id uuid;
  v_resolved_actor_type varchar(30);
  v_changed_fields text[] := array[]::text[];
begin
  v_current_actor_id := (select auth.uid());
  if v_current_actor_id is not null then
    v_resolved_actor_type := 'authenticated_user';
  else
    v_resolved_actor_type := 'system_or_internal';
  end if;

  -- 1. Transición de estado de actividad
  if (new.status is distinct from old.status) then
    insert into public.audit_logs (actor_id, actor_type, action, target_table, target_id, payload)
    values (
      v_current_actor_id,
      v_resolved_actor_type,
      'activity_status_change',
      'activities',
      new.id,
      jsonb_build_object(
        'public_code', new.public_code,
        'old_status', old.status,
        'new_status', new.status,
        'opened_at', new.opened_at,
        'closed_at', new.closed_at
      )
    );
  end if;

  -- 2. Modificación de otros campos relevantes (nombres reales de columnas del esquema)
  if (new.title is distinct from old.title) then
    v_changed_fields := array_append(v_changed_fields, 'title');
  end if;

  if (new.question is distinct from old.question) then
    v_changed_fields := array_append(v_changed_fields, 'question');
  end if;

  if (new.moderation_mode is distinct from old.moderation_mode) then
    v_changed_fields := array_append(v_changed_fields, 'moderation_mode');
  end if;

  if (coalesce(array_length(v_changed_fields, 1), 0) > 0) then
    insert into public.audit_logs (actor_id, actor_type, action, target_table, target_id, payload)
    values (
      v_current_actor_id,
      v_resolved_actor_type,
      'activity_updated',
      'activities',
      new.id,
      jsonb_build_object(
        'public_code', new.public_code,
        'changed_fields', v_changed_fields
      )
    );
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------------------------
-- 6. DISPARADORES DE ROLES: TRAZABILIDAD RELACIONAL (H-11 / H-15)
-- ------------------------------------------------------------------------------

-- Función AFTER INSERT OR DELETE: audita altas y bajas de administradores globales
create or replace function public.fn_audit_user_roles_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_actor_id uuid;
  v_resolved_actor_type varchar(30);
begin
  v_current_actor_id := (select auth.uid());
  if v_current_actor_id is not null then
    v_resolved_actor_type := 'authenticated_user';
  else
    v_resolved_actor_type := 'system_or_internal';
  end if;

  if (tg_op = 'INSERT') then
    if (new.role = 'admin_global') then
      insert into public.audit_logs (actor_id, actor_type, action, target_table, target_id, payload)
      values (
        v_current_actor_id,
        v_resolved_actor_type,
        'admin_role_granted',
        'user_roles',
        new.user_id,
        jsonb_build_object(
          'role', new.role,
          'granted_user_id', new.user_id
        )
      );
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if (old.role = 'admin_global') then
      insert into public.audit_logs (actor_id, actor_type, action, target_table, target_id, payload)
      values (
        v_current_actor_id,
        v_resolved_actor_type,
        'admin_role_revoked',
        'user_roles',
        old.user_id,
        jsonb_build_object(
          'role', old.role,
          'revoked_user_id', old.user_id
        )
      );
    end if;
    return old;
  end if;

  return null;
end;
$$;

-- ------------------------------------------------------------------------------
-- 7. REEMPLAZO Y ENLACE DE DISPARADORES RELACIONALES (IDEMPOTENCIA)
-- ------------------------------------------------------------------------------

-- Retirar disparadores legados de la Migración 5
drop trigger if exists trg_audit_activities_mutation on public.activities;
drop trigger if exists trg_audit_ideas_mutation on public.ideas;

-- Retirar disparadores previos si ya existieran
drop trigger if exists trg_audit_activity_before_delete on public.activities;
drop trigger if exists trg_audit_activity_after_delete on public.activities;
drop trigger if exists trg_audit_activity_update on public.activities;
drop trigger if exists trg_audit_idea_before_delete on public.ideas;
drop trigger if exists trg_audit_idea_created on public.ideas;
drop trigger if exists trg_audit_idea_update on public.ideas;
drop trigger if exists trg_audit_user_roles on public.user_roles;

-- Enlazar disparadores de activities
create trigger trg_audit_activity_before_delete
  before delete on public.activities
  for each row
  execute function public.fn_audit_activity_before_delete();

create trigger trg_audit_activity_after_delete
  after delete on public.activities
  for each row
  execute function public.fn_audit_activity_after_delete();

create trigger trg_audit_activity_update
  after update on public.activities
  for each row
  execute function public.fn_audit_activity_update();

-- Enlazar disparadores de ideas
create trigger trg_audit_idea_before_delete
  before delete on public.ideas
  for each row
  execute function public.fn_audit_idea_delete();

create trigger trg_audit_idea_created
  after insert on public.ideas
  for each row
  execute function public.fn_audit_idea_created();

create trigger trg_audit_idea_update
  after update of status on public.ideas
  for each row
  execute function public.fn_audit_idea_update();

-- Enlazar disparador de user_roles
create trigger trg_audit_user_roles
  after insert or delete on public.user_roles
  for each row
  execute function public.fn_audit_user_roles_mutation();

-- ------------------------------------------------------------------------------
-- 8. REVOCACIÓN PREVENTIVA DE PRIVILEGIOS DE EJECUCIÓN DIRECTA
-- ------------------------------------------------------------------------------
-- Impide la invocación manual o RPC directa de las funciones disparadoras
revoke all on function public.fn_audit_activity_before_delete() from public, anon, authenticated;
revoke all on function public.fn_audit_activity_after_delete() from public, anon, authenticated;
revoke all on function public.fn_audit_activity_update() from public, anon, authenticated;
revoke all on function public.fn_audit_idea_delete() from public, anon, authenticated;
revoke all on function public.fn_audit_idea_created() from public, anon, authenticated;
revoke all on function public.fn_audit_idea_update() from public, anon, authenticated;
revoke all on function public.fn_audit_user_roles_mutation() from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 9. ÍNDICE COMPUESTO PARA DESAMBIGUACIÓN DETERMINISTA DE CONSULTAS (H-17)
-- ------------------------------------------------------------------------------
-- NOTA TÉCNICA: Este índice proporciona un orden de presentación determinista y
-- reproducible para consultas y paginación ante timestamps idénticos (now()), pero
-- se reconoce que por sí solo no acredita la secuencia causal fáctica de eventos
-- generados en el mismo tick de reloj.
create index if not exists audit_logs_created_at_id_idx
  on public.audit_logs (created_at desc, id desc);

