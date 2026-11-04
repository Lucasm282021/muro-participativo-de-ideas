-- ==============================================================================
-- Script: scripts/admin/assign_admin_global.sql
-- Propósito: Asignación segura y transaccional del rol 'admin_global' (H-15 / H-11)
-- Estado: PLANTILLA REVISABLE - NO EJECUTAR DIRECTAMENTE SIN REEMPLAZAR PLACEHOLDERS
-- Restricciones: No contiene credenciales ni identificadores reales.
-- Versión: 2.0.0 (Fase B3-C)
-- ==============================================================================

-- ADVERTENCIA TÉCNICA Y DE AUDITORÍA:
-- 1. Este script debe ejecutarse de forma manual y controlada desde el SQL Editor
--    de Supabase o consola de infraestructura por personal debidamente autorizado.
-- 2. Con la migración 7 (20261020130000_administrative_audit_hardening.sql) vigente,
--    el trigger 'trg_audit_user_roles' registra automáticamente en public.audit_logs:
--      - 'admin_role_granted' al insertar un rol 'admin_global';
--      - 'admin_role_revoked' al eliminarlo.
--    La fila de auditoría se escribe en la MISMA transacción que la mutación.
-- 3. El trigger no puede identificar al operador humano cuando la ejecución se
--    realiza desde el SQL Editor: auth.uid() es NULL, por lo que queda
--    actor_id = NULL y actor_type = 'system_or_internal'. La identidad del
--    operador debe acreditarse mediante el ticket de cambio y los registros de
--    la plataforma (Platform Audit Trail / logs de infraestructura).
-- 4. Este script NO inserta filas manuales en public.audit_logs.
-- 5. La huella MD5 del baseline es un control de deriva (integridad operativa),
--    NO un hash criptográfico de seguridad. Su única finalidad es detectar que
--    el conjunto de administradores cambió entre la aprobación y la ejecución.
-- 6. Atomicidad: el bloque es UNA sola sentencia DO. Cualquier RAISE EXCEPTION
--    revierte todo el bloque, incluida la fila de auditoría del trigger. No se
--    requieren BEGIN/COMMIT explícitos y no deben añadirse.
--
-- PROCEDIMIENTO PREVIO OBLIGATORIO:
--   a. Ejecutar scripts/admin/check_admin_baseline.sql (solo lectura) y adjuntar
--      su salida al ticket.
--   b. Aprobar el baseline (conteo + huella) y revisar las identidades (user_id)
--      contra el plantel autorizado, sin exponer correos en el expediente.
--   c. Reemplazar los tres placeholders de configuración de este script.
--   d. Ejecutar inmediatamente después de aprobar el baseline. Si media una
--      demora, repetir el pre-chequeo y volver a aprobar.
-- ==============================================================================

DO $$
DECLARE
  -- ---------------------------------------------------------------------------
  -- CONFIGURACIÓN DE PARÁMETROS (reemplazar los tres placeholders):
  -- ---------------------------------------------------------------------------
  -- Correo institucional exacto del usuario a promover.
  c_target_email CONSTANT text := 'PLACEHOLDER_USER_EMAIL';

  -- Conteo aprobado de administradores globales (salida del pre-chequeo).
  c_expected_admin_count CONSTANT int := NULL; -- REEMPLAZAR: conteo aprobado

  -- Huella aprobada de identidades (salida del pre-chequeo). Debe coincidir
  -- exactamente con la expresión usada en check_admin_baseline.sql.
  c_expected_admin_fingerprint CONSTANT text := NULL; -- REEMPLAZAR: huella aprobada

  v_actual_admin_count bigint;
  v_actual_admin_fingerprint text;
  v_matching_users bigint;
  v_user_id uuid;
  v_email_confirmed_at timestamptz;
  v_role_exists boolean;
BEGIN
  -- Guarda 1: placeholder o correo vacío.
  IF c_target_email = 'PLACEHOLDER_USER_EMAIL' OR trim(c_target_email) = '' THEN
    RAISE EXCEPTION 'B3C-01: Operación abortada: el correo objetivo es el placeholder o está vacío.';
  END IF;

  -- Guarda 2: baseline no aprobado.
  IF c_expected_admin_count IS NULL OR c_expected_admin_fingerprint IS NULL
     OR trim(c_expected_admin_fingerprint) = '' THEN
    RAISE EXCEPTION 'B3C-02: Operación abortada: baseline no aprobado (conteo y/o huella ausentes).';
  END IF;

  -- Guarda 3: deriva de conteo respecto del baseline aprobado.
  SELECT count(*), coalesce(md5(string_agg(user_id::text, ',' order by user_id)), md5(''))
    INTO v_actual_admin_count, v_actual_admin_fingerprint
  FROM public.user_roles
  WHERE role = 'admin_global';

  IF v_actual_admin_count <> c_expected_admin_count THEN
    RAISE EXCEPTION 'B3C-03: Operación abortada: deriva de baseline; se esperaban % administradores globales y existen %.',
      c_expected_admin_count, v_actual_admin_count;
  END IF;

  -- Guarda 4: deriva de identidades (detecta sustitución con igual conteo).
  IF v_actual_admin_fingerprint <> c_expected_admin_fingerprint THEN
    RAISE EXCEPTION 'B3C-04: Operación abortada: deriva de baseline en las identidades de administradores globales.';
  END IF;

  -- Guarda 5 y 6: coincidencia inequívoca del usuario objetivo.
  SELECT count(*)
    INTO v_matching_users
  FROM auth.users
  WHERE lower(email) = lower(trim(c_target_email));

  IF v_matching_users = 0 THEN
    RAISE EXCEPTION 'B3C-05: Operación abortada: no existe ningún usuario con el correo indicado.';
  END IF;

  IF v_matching_users > 1 THEN
    RAISE EXCEPTION 'B3C-06: Operación abortada: % usuarios coinciden con el correo indicado; se requiere coincidencia única.',
      v_matching_users;
  END IF;

  SELECT id, email_confirmed_at
    INTO v_user_id, v_email_confirmed_at
  FROM auth.users
  WHERE lower(email) = lower(trim(c_target_email));

  -- Guarda 7: cuenta con correo no confirmado.
  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'B3C-07: Operación abortada: la cuenta objetivo no tiene el correo confirmado (email_confirmed_at IS NULL).';
  END IF;

  -- Guarda 8 (idempotencia): el usuario ya posee el rol. No se inserta ni se audita nada.
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_user_id AND role = 'admin_global'
  ) INTO v_role_exists;

  IF v_role_exists THEN
    RAISE NOTICE 'B3C-N1: Sin cambios: el usuario % ya posee el rol admin_global.', v_user_id;
    RETURN;
  END IF;

  -- Inserción atómica. El trigger de auditoría de la migración 7 registra
  -- 'admin_role_granted' en la misma transacción.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin_global');

  RAISE NOTICE 'B3C-N2: Rol admin_global asignado al usuario %.', v_user_id;
END $$;
