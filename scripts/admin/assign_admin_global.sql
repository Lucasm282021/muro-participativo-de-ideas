-- ==============================================================================
-- Script: scripts/admin/assign_admin_global.sql
-- Propósito: Asignación segura y transaccional del rol 'admin_global' (H-15 / H-11)
-- Estado: PLANTILLA REVISABLE - NO EJECUTAR DIRECTAMENTE SIN REEMPLAZAR PLACEHOLDER
-- Restricciones: No contiene credenciales ni identificadores reales.
-- ==============================================================================

-- ADVERTENCIA TÉCNICA Y DE AUDITORÍA:
-- 1. Este script debe ejecutarse de forma manual y controlada desde el SQL Editor
--    de Supabase o consola de infraestructura por personal debidamente autorizado.
-- 2. En el esquema actual (migraciones 1 a 6), la tabla 'public.user_roles' no cuenta
--    con triggers automáticos hacia 'public.audit_logs'.
-- 3. Por diseño y apego a la rigurosidad relacional, este script NO inserta registros
--    manuales en 'audit_logs' para no simular una trazabilidad que no está garantizada
--    por el motor de base de datos. Toda ejecución queda trazada en los logs de la
--    plataforma/infraestructura Supabase. La incorporación de un trigger relacional en
--    'user_roles' está sujeta a definición técnica en la futura Migración 7.

DO $$
DECLARE
  -- ---------------------------------------------------------------------------
  -- CONFIGURACIÓN DE PARÁMETROS:
  -- Reemplazar el marcador de posición con el correo electrónico del usuario a promover.
  -- ---------------------------------------------------------------------------
  c_target_email CONSTANT text := 'PLACEHOLDER_USER_EMAIL';

  v_user_id uuid;
  v_role_exists boolean;
BEGIN
  -- Validar que no se intente ejecutar con el marcador de posición intacto
  IF c_target_email = 'PLACEHOLDER_USER_EMAIL' OR trim(c_target_email) = '' THEN
    RAISE EXCEPTION 'Operación abortada: Debe especificar un correo electrónico válido reemplazando PLACEHOLDER_USER_EMAIL.';
  END IF;

  -- 1. Verificar existencia inequívoca en auth.users
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(c_target_email));

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado en auth.users con correo: %', c_target_email;
  END IF;

  -- 2. Verificar si el usuario ya posee el rol admin_global
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_user_id AND role = 'admin_global'
  ) INTO v_role_exists;

  IF v_role_exists THEN
    RAISE NOTICE 'El usuario % (ID: %) ya posee el rol admin_global. No se requieren cambios.', c_target_email, v_user_id;
    RETURN;
  END IF;

  -- 3. Inserción atómica y segura del rol administrativo
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin_global');

  RAISE NOTICE 'Rol admin_global asignado exitosamente al usuario % (ID: %).', c_target_email, v_user_id;

END $$;
