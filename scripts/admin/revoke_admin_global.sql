-- ==============================================================================
-- Script: scripts/admin/revoke_admin_global.sql
-- Propósito: Revocación segura, atómica y transaccional del rol 'admin_global' (H-15 / H-11)
-- Estado: PLANTILLA REVISABLE - NO EJECUTAR DIRECTAMENTE SIN REEMPLAZAR PLACEHOLDER
-- Restricciones: No contiene credenciales ni identificadores reales.
-- ==============================================================================
--
-- ADVERTENCIA TÉCNICA Y DE AUDITORÍA:
-- 1. Este script debe ejecutarse de forma manual y controlada desde el SQL Editor
--    de Supabase o consola de infraestructura por personal debidamente autorizado.
-- 2. La revocación elimina exclusivamente el registro en 'public.user_roles' con
--    role = 'admin_global' para el usuario indicado, sin alterar 'auth.users' ni
--    otros datos del sistema.
-- 3. Si el disparador 'trg_audit_user_roles' está activo (Migración 7), la acción
--    quedará registrada de forma transaccional en 'public.audit_logs' con la acción
--    'admin_role_revoked'. Toda ejecución queda además trazada en los logs de
--    infraestructura de Supabase.
-- 4. Dado que la verificación de autorización en servidor (checkAdminAuthorization)
--    consulta de forma fresca 'public.is_admin()', el efecto de la revocación es
--    instantáneo para cualquier sesión activa del usuario.
-- ==============================================================================

DO $$
DECLARE
  -- ---------------------------------------------------------------------------
  -- CONFIGURACIÓN DE PARÁMETROS:
  -- Reemplazar el marcador de posición con el correo electrónico del usuario a revocar.
  -- ---------------------------------------------------------------------------
  c_target_email CONSTANT text := 'PLACEHOLDER_USER_EMAIL';

  v_user_id uuid;
  v_role_exists boolean;
  v_deleted_count integer;
BEGIN
  -- 1. Validar que no se intente ejecutar con el marcador de posición intacto
  IF c_target_email = 'PLACEHOLDER_USER_EMAIL' OR trim(c_target_email) = '' THEN
    RAISE EXCEPTION 'Operación abortada: Debe especificar un correo electrónico válido reemplazando PLACEHOLDER_USER_EMAIL.';
  END IF;

  -- 2. Verificar existencia inequívoca en auth.users
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(c_target_email));

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado en auth.users con correo: %', c_target_email;
  END IF;

  -- 3. Verificar si el usuario posee efectivamente el rol admin_global
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_user_id AND role = 'admin_global'
  ) INTO v_role_exists;

  IF NOT v_role_exists THEN
    RAISE NOTICE 'El usuario % (ID: %) no posee el rol admin_global. No se requieren cambios.', c_target_email, v_user_id;
    RETURN;
  END IF;

  -- 4. Eliminación atómica y acotada del rol administrativo
  DELETE FROM public.user_roles
  WHERE user_id = v_user_id AND role = 'admin_global';

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- 5. Comprobación defensiva de integridad
  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'Error de integridad: Se esperaba revocar exactamente 1 rol pero se eliminaron % filas. Operación abortada.', v_deleted_count;
  END IF;

  RAISE NOTICE 'Rol admin_global revocado exitosamente para el usuario % (ID: %).', c_target_email, v_user_id;

END $$;

