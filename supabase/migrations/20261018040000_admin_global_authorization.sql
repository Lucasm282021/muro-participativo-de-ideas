-- Migration: 20261018040000_admin_global_authorization.sql
-- Propuesta técnica para Fase 2: Roles de administración global, RLS aditivo, inmutabilidad de owner_id y auditoría transaccional.
-- NOTA: Archivo preparado para revisión técnica. NO ejecutar ni aplicar sin autorización explícita e independiente.

-- 1. Tipo enumerado para roles de sistema
create type public.app_role as enum ('admin_global');

-- 2. Tabla de asignación de roles administrativos
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now()
);

-- Habilitar RLS y revocar todo acceso directo a roles cliente
alter table public.user_roles enable row level security;
revoke all on table public.user_roles from public, anon, authenticated;

-- 3. Función autorizadora con privilegios elevados (Security Definer)
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = 'admin_global'
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

-- 4. Inmutabilidad estricta de activities.owner_id
-- Impide cualquier reasignación de titularidad de actividades a nivel de motor de BD.
create or replace function public.prevent_activity_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'El campo owner_id es inmutable y no puede modificarse'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger activities_prevent_owner_change
  before update on public.activities
  for each row
  execute function public.prevent_activity_owner_change();

-- 5. Tabla de auditoría transaccional inmutable (audit_logs)
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_type varchar(30) not null default 'authenticated_user',
  action varchar(50) not null,
  target_table varchar(50) not null,
  target_id uuid not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Índices para consultas operativas de auditoría
create index audit_logs_target_idx on public.audit_logs (target_table, target_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

-- Blindaje RLS de la bitácora
alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from public, anon, authenticated;
grant select on table public.audit_logs to authenticated;

-- 6. Trigger de auditoría para activities
create or replace function public.audit_activity_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid;
  resolved_actor_type varchar(30);
begin
  current_actor_id := (select auth.uid());
  if current_actor_id is not null then
    resolved_actor_type := 'authenticated_user';
  else
    resolved_actor_type := 'system_or_internal';
  end if;

  if (tg_op = 'DELETE') then
    insert into public.audit_logs (actor_id, actor_type, action, target_table, target_id, payload)
    values (
      current_actor_id,
      resolved_actor_type,
      'activity_delete',
      'activities',
      old.id,
      jsonb_build_object(
        'actor_id_snapshot', current_actor_id,
        'title', old.title,
        'public_code', old.public_code,
        'owner_id', old.owner_id,
        'status', old.status,
        'moderation_mode', old.moderation_mode,
        'opened_at', old.opened_at,
        'closed_at', old.closed_at
      )
    );
    return old;
  elsif (tg_op = 'UPDATE') then
    if (new.status is distinct from old.status) then
      insert into public.audit_logs (actor_id, actor_type, action, target_table, target_id, payload)
      values (
        current_actor_id,
        resolved_actor_type,
        'activity_status_change',
        'activities',
        new.id,
        jsonb_build_object(
          'actor_id_snapshot', current_actor_id,
          'old_status', old.status,
          'new_status', new.status,
          'public_code', new.public_code,
          'opened_at', new.opened_at,
          'closed_at', new.closed_at
        )
      );
    end if;
    return new;
  end if;
  return null;
end;
$$;

create trigger trg_audit_activities_mutation
  after update or delete on public.activities
  for each row
  execute function public.audit_activity_mutation();

-- 7. Trigger de auditoría para ideas
-- Suprime duplicación en cascadas: Si la actividad padre está siendo eliminada, no genera eventos individuales masivos.
create or replace function public.audit_idea_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid;
  resolved_actor_type varchar(30);
  parent_exists boolean;
begin
  current_actor_id := (select auth.uid());
  if current_actor_id is not null then
    resolved_actor_type := 'authenticated_user';
  else
    resolved_actor_type := 'system_or_internal';
  end if;

  if (tg_op = 'UPDATE') then
    if (new.status is distinct from old.status) then
      insert into public.audit_logs (actor_id, actor_type, action, target_table, target_id, payload)
      values (
        current_actor_id,
        resolved_actor_type,
        'idea_moderate_status',
        'ideas',
        new.id,
        jsonb_build_object(
          'actor_id_snapshot', current_actor_id,
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
  elsif (tg_op = 'DELETE') then
    -- Verificar si la actividad padre todavía existe en la base de datos
    -- Durante un ON DELETE CASCADE de activities, la actividad ya no existe o está en borrado,
    -- por lo que se suprime el log individual para evitar duplicación y amplificación de escrituras.
    select exists (
      select 1 from public.activities where id = old.activity_id
    ) into parent_exists;

    if parent_exists then
      insert into public.audit_logs (actor_id, actor_type, action, target_table, target_id, payload)
      values (
        current_actor_id,
        resolved_actor_type,
        'idea_delete_individual',
        'ideas',
        old.id,
        jsonb_build_object(
          'actor_id_snapshot', current_actor_id,
          'activity_id', old.activity_id,
          'status', old.status,
          'published_at', old.published_at,
          'content_length', char_length(old.content)
        )
      );
    end if;
    return old;
  end if;
  return null;
end;
$$;

create trigger trg_audit_ideas_mutation
  after update of status or delete on public.ideas
  for each row
  execute function public.audit_idea_mutation();

-- 8. Políticas RLS aditivas para administración global (lógica OR con políticas preexistentes)
create policy "Admins can read all activities"
  on public.activities
  for select
  to authenticated
  using (public.is_admin());

create policy "Admins can update all activities"
  on public.activities
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete all activities"
  on public.activities
  for delete
  to authenticated
  using (public.is_admin());

create policy "Admins can read all ideas"
  on public.ideas
  for select
  to authenticated
  using (public.is_admin());

create policy "Admins can moderate all ideas"
  on public.ideas
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete all ideas"
  on public.ideas
  for delete
  to authenticated
  using (public.is_admin());

create policy "Admins can read all participants"
  on public.participants
  for select
  to authenticated
  using (public.is_admin());

create policy "Admins can read all idea authors"
  on public.idea_authors
  for select
  to authenticated
  using (public.is_admin());
