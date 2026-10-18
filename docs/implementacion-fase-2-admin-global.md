# Propuesta Técnica de Implementación — Admin Fase 2

**Proyecto:** Muro Participativo de Ideas  
**Rama:** `feat/pagina-administracion-from-dev`  
**HEAD:** `0a12e2a95d8f6234070d2480f2f3817f6b51143c`  
**Estado:** Código preparado en rama de desarrollo. **NO aplicado ni ejecutado en base de datos.**  

---

## 1. Archivos Preparados

1. **Migración DDL:**
   - [`supabase/migrations/20261018040000_admin_global_authorization.sql`](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/supabase/migrations/20261018040000_admin_global_authorization.sql)
   - Contiene el tipo `public.app_role`, tabla `public.user_roles`, función `public.is_admin()` (`security definer`), trigger de inmutabilidad de `owner_id`, tabla de auditoría `public.audit_logs` con índices, triggers de auditoría en `activities` e `ideas`, y políticas RLS aditivas.
2. **Utilidad de Autorización en Servidor:**
   - [`src/lib/auth/admin.ts`](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/src/lib/auth/admin.ts)
   - Función `checkAdminAuthorization(supabase)` con verificación de sesión y consulta fresca a `is_admin()`, retornando `AdminAuthResult` sin lanzar excepciones no controladas.
3. **Server Actions de Administración:**
   - [`src/app/admin/actions.ts`](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/src/app/admin/actions.ts)
   - `adminModerateIdeaAction`: moderación de ideas con validación Zod, verificación de rol e idempotencia.
   - `adminToggleActivityAction`: cierre y reapertura con actualización de `closed_at`/`opened_at`.
   - `adminDeleteActivityAction`: eliminación con verificación obligatoria de `confirmationCode === activity.public_code`.
4. **Componentes Interactivos de Administración:**
   - [`src/app/admin/components/admin-activity-row.tsx`](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/src/app/admin/components/admin-activity-row.tsx)
   - [`src/app/admin/components/admin-idea-row.tsx`](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/src/app/admin/components/admin-idea-row.tsx)
5. **Página Principal de Administración Actualizada:**
   - [`src/app/admin/page.tsx`](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/src/app/admin/page.tsx)
   - Declarada con `export const dynamic = "force-dynamic"`.
   - Soporte dual: si el usuario no tiene el rol asignado o la migración no está aplicada, muestra el diagnóstico seguro; si está acreditado, renderiza el panel operativo completo.
6. **Estilos Específicos:**
   - [`src/app/admin/admin.css`](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/src/app/admin/admin.css)

---

## 2. Decisiones de Seguridad Aplicadas

- **Supresión de duplicados en cascada:** El trigger de auditoría sobre `ideas` verifica si la actividad padre todavía existe (`IF EXISTS (SELECT 1 FROM public.activities WHERE id = OLD.activity_id)`). Si la actividad padre está siendo eliminada (cascada), se suprime el log individual de cada idea para evitar amplificación de escrituras y duplicación de eventos.
- **Snapshot de auditoría inmutable (`actor_id_snapshot`):** En `public.audit_logs`, la columna `actor_id` referencia `auth.users(id) on delete set null`. Para evitar la pérdida de trazabilidad ante la eliminación de una cuenta, los payloads JSONB de los 4 eventos auditados almacenan `'actor_id_snapshot', current_actor_id`. Si la cuenta es purgada de `auth.users`, la columna relacional se fija en `NULL`, pero el documento JSONB preserva el snapshot histórico del UUID.
- **Minimización de datos y naturaleza del UUID:** El snapshot almacena únicamente el identificador UUID opaco (sin emails, nombres ni IPs). El UUID es una referencia histórica de correlación, no una prueba criptográfica de identidad, y privilegios elevados de infraestructura (`postgres`, `service_role`) retienen la capacidad de alterar la base de datos si el entorno es vulnerado.
- **Inmutabilidad de `owner_id`:** Implementada mediante el trigger `activities_prevent_owner_change` que aborta cualquier intento de cambiar la titularidad de una actividad.
- **Doble barrera en eliminación:** Se exige validación de rol de servidor Y coincidencia exacta del código público (`public_code`).
- **Contrato uniforme:** Todas las Server Actions retornan `{ error?: string; success?: string }` (`FormState`).
- **Zero Secret Exposure:** No se utiliza `service_role` en cliente ni se exponen credenciales privilegiadas.

---

## 3. Próximos Pasos (Requieren Autorización Independiente)

1. Autorización explícita e independiente para aplicar la migración DDL localmente en la instancia aislada de PostgreSQL (puerto `25433`, API `http://127.0.0.1:25435`).
2. Asignación del rol `admin_global` a la cuenta sintética de prueba en `public.user_roles` vía consola local de base de datos.
3. Ejecución de la matriz de pruebas funcionales en Dev con las 4 cuentas sintéticas.
