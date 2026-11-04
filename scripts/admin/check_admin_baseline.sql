-- ==============================================================================
-- Script: scripts/admin/check_admin_baseline.sql
-- Propósito: Pre-chequeo de SOLO LECTURA para aprobar el baseline de
--            administradores globales antes de ejecutar
--            scripts/admin/assign_admin_global.sql (Fase B3-C).
-- Estado: PLANTILLA REVISABLE - SOLO SELECT. No modifica datos ni esquema.
-- Restricciones: No contiene credenciales. Sustituir únicamente el placeholder
--                de correo si se desea resolver la identidad objetivo.
-- ==============================================================================
--
-- USO:
--   1. Ejecutar el archivo completo en el SQL Editor (o psql) como rol
--      administrativo, inmediatamente antes de la asignación.
--   2. Adjuntar la salida al ticket de cambio.
--   3. La persona responsable aprueba admin_count y admin_fingerprint, y revisa
--      la lista de identidades (user_id + created_at) contra el plantel
--      autorizado. El expediente NO debe contener correos completos.
--   4. Transcribir admin_count y admin_fingerprint al script de asignación.
--
-- NOTA SOBRE LA HUELLA:
--   admin_fingerprint se calcula con MD5 sobre la lista ordenada de user_id y se
--   usa SOLO como control de deriva (integridad operativa). NO es un hash
--   criptográfico de seguridad. La expresión debe ser idéntica a la del script
--   de asignación:
--     coalesce(md5(string_agg(user_id::text, ',' order by user_id)), md5(''))
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- A. Baseline actual: conteo + huella determinista.
-- ------------------------------------------------------------------------------
SELECT
  count(*) AS admin_count,
  coalesce(md5(string_agg(user_id::text, ',' order by user_id)), md5('')) AS admin_fingerprint
FROM public.user_roles
WHERE role = 'admin_global';

-- ------------------------------------------------------------------------------
-- B. Identidades que componen el baseline (revisión por la persona responsable).
--    Solo identificadores y fechas: sin correos.
-- ------------------------------------------------------------------------------
SELECT user_id, created_at
FROM public.user_roles
WHERE role = 'admin_global'
ORDER BY user_id;

-- ------------------------------------------------------------------------------
-- C. Identidad objetivo (sustituir el placeholder antes de ejecutar).
--    No devuelve el correo: solo el user_id, si está confirmado y si ya es admin.
-- ------------------------------------------------------------------------------
WITH params AS (
  SELECT 'PLACEHOLDER_USER_EMAIL'::text AS target_email
),
matches AS (
  SELECT u.id, u.email_confirmed_at
  FROM auth.users u
  CROSS JOIN params p
  WHERE lower(u.email) = lower(trim(p.target_email))
)
SELECT
  (SELECT count(*) FROM matches) AS matching_users,
  (SELECT id FROM matches LIMIT 1) AS resolved_user_id,
  (SELECT email_confirmed_at IS NOT NULL FROM matches LIMIT 1) AS email_confirmed,
  EXISTS (
    SELECT 1
    FROM public.user_roles r
    WHERE r.user_id = (SELECT id FROM matches LIMIT 1)
      AND r.role = 'admin_global'
  ) AS already_admin;

-- ------------------------------------------------------------------------------
-- D. Verificación del esquema vigente (migraciones 5 y 7 aplicadas).
-- ------------------------------------------------------------------------------
SELECT
  to_regclass('public.user_roles') IS NOT NULL AS user_roles_exists,
  to_regclass('public.audit_logs') IS NOT NULL AS audit_logs_exists,
  to_regprocedure('public.is_admin()') IS NOT NULL AS is_admin_exists,
  EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_user_roles_mutation'
  ) AS audit_function_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_audit_user_roles' AND NOT tgisinternal
  ) AS audit_trigger_exists;

-- ------------------------------------------------------------------------------
-- E. Referencia de auditoría: eventos de rol existentes por acción y objetivo.
--    Sirve para comparar el antes y el después de la asignación.
-- ------------------------------------------------------------------------------
SELECT action, target_id, count(*) AS events
FROM public.audit_logs
WHERE action IN ('admin_role_granted', 'admin_role_revoked')
GROUP BY action, target_id
ORDER BY action, target_id;

SELECT count(*) AS total_audit_events
FROM public.audit_logs;
