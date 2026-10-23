# Procedimiento Operativo Estándar: Gestión del Rol `admin_global` (H-15 / H-11)

**Proyecto:** Muro Participativo de Ideas  
**Ámbito:** Seguridad, Autorización y Control de Acceso Administrativo  
**Versión:** 1.1.1
**Fecha de emisión:** 20 de octubre de 2026  
**Última revisión:** 22 de octubre de 2026 (Fase B3-M)
**Clasificación:** Confidencial / Uso Operativo Interno  

---

## 1. Propósito y alcance

Este documento establece el procedimiento técnico y administrativo para la asignación, verificación, auditoría y revocación del rol `admin_global` en la base de datos del Muro Participativo de Ideas.

Aplica exclusivamente al personal autorizado con acceso a la consola de infraestructura (Supabase SQL Editor / CLI con credenciales administrativas directas). **Bajo ninguna circunstancia este procedimiento debe exponerse como un servicio web, endpoint API ni Server Action accesible desde la aplicación.**

---

## 2. Separación de responsabilidades

Para dar cumplimiento al principio de menor privilegio y evitar la concentración de facultades:

1. **Solicitante (Responsable de Producto o Coordinación General):**
   - Identifica la necesidad operativa de asignar un administrador global.
   - Emite una solicitud formal indicando el correo electrónico institucional del usuario objetivo y la justificación del acceso.
2. **Aprobador (Oficial de Seguridad / Arquitecto de Software):**
   - Valida la legitimidad de la solicitud, verifica el principio de necesidad de saber (*need-to-know*) y corrobora que el usuario cuente con los mecanismos de seguridad requeridos (ej. autenticación reforzada).
   - Autoriza por escrito o mediante ticket de seguridad la ejecución.
3. **Ejecutor (Operador de Infraestructura / Administrador de Base de Datos):**
   - Ejecuta de forma manual y controlada el script SQL de aprovisionamiento en la consola protegida.
   - Verifica el resultado y confirma el registro en la bitácora operativa.
   - **Prohibición estricta:** Ningún usuario puede ejecutar el procedimiento para asignarse privilegios a sí mismo (prevención de autoasignación).

---

## 3. Identificación inequívoca del usuario objetivo

La asignación de permisos jamás debe basarse en nombres de usuario informales ni en UUIDs no corroborados:

1. El usuario debe haber completado previamente su registro en el proveedor de identidad de la plataforma (`auth.users`).
2. El operador debe verificar que el correo institucional coincida de manera exacta y que la cuenta se encuentre confirmada (`email_confirmed_at IS NOT NULL`).
3. El UUID del usuario debe obtenerse directamente mediante la consulta de solo lectura del pre-chequeo sobre `auth.users`, dentro de la misma ventana aprobada, evitando que un operador tipee o copie manualmente identificadores arbitrarios.
4. La consulta de resolución debe distinguir explícitamente tres casos y no depender de errores implícitos del motor:
   - **cero coincidencias:** abortar indicando que el usuario no existe;
   - **más de una coincidencia:** abortar indicando el número de coincidencias (no se elige una arbitrariamente);
   - **una única coincidencia:** continuar.
5. Los mensajes de error y de éxito deben identificarse por `user_id`, no por correo electrónico. La salida de ejecución y los registros de plataforma no deben contener correos completos; el correo exacto solo se registra en el instrumento de autorización y en el ticket restringido, cuando sea necesario para la identificación aprobada.

---

## 4. Protección y blindaje del esquema (H-11)

En la base de datos, el control de acceso a roles está protegido por las siguientes capas relacionales (definidas en la migración 5 `20261018040000_admin_global_authorization.sql`):

1. **Tabla `public.user_roles`:**
   - Estructura: `user_id uuid primary key references auth.users(id) on delete cascade`, `role public.app_role not null`, `created_at timestamptz`.
   - **Row Level Security (RLS):** Habilitada estrictamente.
   - **Permisos (Grants):** Se ha revocado todo permiso directo (`REVOKE ALL ON TABLE public.user_roles FROM public, anon, authenticated;`). Ningún cliente o usuario ordinario puede leer, insertar, actualizar ni borrar en esta tabla vía PostgREST o Supabase Client.
2. **Función autorizadora `public.is_admin()`:**
   - Definida como `SECURITY DEFINER` con `SET search_path = ''` para prevenir ataques de sustitución de rutas de búsqueda.
   - Estable (`STABLE`) para optimización de consultas.
   - Permiso de ejecución otorgado únicamente a `authenticated` (`REVOKE ALL FROM public, anon; GRANT EXECUTE TO authenticated;`).
   - Consulta internamente `public.user_roles` filtrando por `user_id = (select auth.uid())` y `role = 'admin_global'`. Si no hay sesión o no coincide el rol, retorna `false`.
3. **Verificación en Servidor (`checkAdminAuthorization`):**
   - La aplicación web (`src/lib/auth/admin.ts`) realiza una consulta autoritativa fresca a `is_admin()` en cada Server Action o carga de página administrativa.
   - No se almacenan ni confían roles en claims estáticos de JWT ni en el cliente (`fail-closed`).

---

## 5. Procedimiento de Alta (Asignación de `admin_global`)

### Precondiciones
- Autorización 1 (solo lectura) firmada y registrada en el ticket.
- Solicitud formal aprobada por el Aprobador.
- Cuenta del usuario creada y confirmada en `auth.users`.
- Baseline de administradores pre-chequeado y aprobado por la persona responsable (conteo, huella, identidades y resolución del beneficiario).
- Constancia de que el Ejecutor no es el Beneficiario (control organizacional G3).
- Acceso del operador a la consola administrativa de Supabase (SQL Editor protegido).
- Autorización 2 (escritura) será emitida solo después de aprobar el baseline; no se firma anticipadamente.

### Paso 0 — Pre-chequeo de solo lectura y aprobación del baseline

1. Verificar que la Autorización 1 (solo lectura) esté firmada y registrada en el ticket.
2. Ejecutar `scripts/admin/check_admin_baseline.sql` **inmediatamente antes** de la asignación. El script es estrictamente de solo lectura.
3. Registrar la salida:
   - `admin_count`: número de filas `admin_global`;
   - `admin_fingerprint`: huella determinista de las identidades;
   - la lista de `user_id` y `created_at` que compone el baseline;
   - la resolución del usuario objetivo (`matching_users`, `resolved_user_id`, `email_confirmed`, `already_admin`);
   - la verificación de que el esquema vigente incluye la tabla, la función y el trigger de auditoría;
   - los eventos de auditoría de rol existentes, como referencia del “antes”.
4. La persona responsable **aprueba y registra** `admin_count`, `admin_fingerprint`, las identidades y la resolución del beneficiario (`matching_users`, `resolved_user_id`, `email_confirmed`, `already_admin`). El plantel autorizado se mantiene fuera del expediente; el expediente no incluye correos completos.
5. Si `matching_users` no es exactamente `1`, el correo no está confirmado, el UUID resuelto no coincide con la designación aprobada o `already_admin` es `true`, **detenerse y reevaluar**. No se intenta resolver la situación ejecutando otra asignación.
6. El conteo por sí solo **no detecta sustituciones**: reemplazar un administrador por otro conserva el número de filas. Por eso la huella de identidades es obligatoria y debe aprobarse junto con el conteo.
7. El baseline solo es válido para la ventana continua, identificada y aprobada en la que se obtuvo. Cualquier interrupción, demora fuera de la ventana aprobada, cambio de sesión o de contexto, o duda sobre la continuidad lo invalida: se repite el pre-chequeo, se genera una nueva huella y se aprueba el nuevo resultado. No se reutiliza un baseline de otro momento. El script detecta deriva de conteo e identidades, pero no demuestra por sí mismo la antigüedad ni la continuidad de la ventana.

### Paso 1 — Preparación del script

1. Confirmar que la Autorización 2 (escritura) esté completa y firmada, y que el baseline siga vigente.
2. Abrir la consola administrativa SQL.
3. Cargar la plantilla `scripts/admin/assign_admin_global.sql`.
4. Sustituir los **tres** placeholders:
   - `PLACEHOLDER_USER_EMAIL` por el correo institucional formal;
   - `NULL` de `c_expected_admin_count` por el conteo aprobado;
   - `NULL` de `c_expected_admin_fingerprint` por la huella aprobada.
5. No modificar ni eliminar las guardas. El script aborta si el baseline no fue reemplazado.

La huella MD5 es un **control de deriva** (integridad operativa), **no** un hash criptográfico de seguridad. Su única finalidad es detectar que el conjunto de administradores cambió entre la aprobación y la ejecución.

### Paso 2 — Ejecución atómica

1. Ejecutar el bloque `DO` completo.
2. El bloque es **una sola sentencia**: es atómico por sí mismo. **No** se añaden `BEGIN`/`COMMIT` explícitos; un único statement tiene semántica de todo-o-nada inequívoca.
3. Cualquier `RAISE EXCEPTION` revierte todo el bloque, incluida la fila de auditoría que escribe el trigger en la misma transacción. No pueden quedar inserciones parciales ni eventos huérfanos.
4. Guardas implementadas (mensajes verificables):

   | Código | Condición | Efecto |
   |---|---|---|
   | `B3C-01` | Correo vacío o placeholder sin sustituir | Aborta, sin cambios |
   | `B3C-02` | Baseline no aprobado (conteo o huella ausentes) | Aborta, sin cambios |
   | `B3C-03` | Conteo actual distinto del aprobado | Aborta, sin cambios |
   | `B3C-04` | Huella actual distinta de la aprobada (sustitución de identidades) | Aborta, sin cambios |
   | `B3C-05` | Cero usuarios con el correo indicado | Aborta, sin cambios |
   | `B3C-06` | Más de un usuario con el correo indicado | Aborta indicando el número, sin cambios |
   | `B3C-07` | Cuenta con `email_confirmed_at IS NULL` | Aborta, sin cambios |
   | `B3C-N1` | El usuario ya posee `admin_global` | No modifica nada (idempotente) |
   | `B3C-N2` | Asignación válida | Inserta una fila y el trigger registra `admin_role_granted` |

### Paso 3 — Verificación posterior

1. Confirmar que existe **una sola** fila nueva en `user_roles` para el `user_id` resuelto, usando el UUID y sin exponer el correo:
   ```sql
   SELECT user_id, role, created_at
   FROM public.user_roles
   WHERE user_id = '<resolved_user_id>';
   ```
2. Confirmar el evento de auditoría nuevo, acotado a la ventana de ejecución:
   ```sql
   SELECT id, actor_id, actor_type, action, target_table, target_id, payload, created_at
   FROM public.audit_logs
   WHERE action = 'admin_role_granted'
     AND target_id = '<resolved_user_id>'
     AND created_at >= '<timestamp_inicio_utc>'
     AND created_at <= '<timestamp_fin_utc>'
   ORDER BY created_at;
   ```
   Se espera exactamente un evento nuevo dentro de la ventana, con `target_table = 'user_roles'`, `target_id = granted_user_id`, `payload = {"role":"admin_global","granted_user_id":"<uuid>"}`, `actor_type = 'system_or_internal'` y `actor_id = NULL` cuando se ejecutó desde el SQL Editor. No se asume que no existan eventos históricos: deben quedar fuera de la ventana o identificarse por `id`.
3. Comparar `user_roles` antes y después: confirmar la única variación autorizada y la ausencia de administradores o cambios inesperados.
4. Confirmar que no aparecieron eventos inesperados comparando con el “antes” del pre-chequeo (`action`, `target_id`, `created_at`).
5. Registrar en el ticket: baseline aprobado, resolución del beneficiario, aprobador, ejecutor, fecha/hora, hash del script, fila creada, evento identificado y referencia a los logs de plataforma archivados.

---

## 6. Procedimiento de Revocación de Privilegios

La baja de un administrador debe ejecutarse inmediatamente ante cambio de funciones, renuncia o sospecha de compromiso:

### Pasos de ejecución
1. Ejecutar en la consola administrativa el siguiente bloque de revocación. La baja también queda registrada automáticamente por la migración 7 (`admin_role_revoked`), con las mismas limitaciones de actor descritas en el apartado 7.
   ```sql
   DO $$
   DECLARE
     v_target_email text := 'usuario.objetivo@institucion.gob.ar'; -- Correo a revocar
     v_user_id uuid;
     v_deleted_count int;
   BEGIN
     SELECT id INTO v_user_id
     FROM auth.users
     WHERE lower(email) = lower(trim(v_target_email));

     IF v_user_id IS NULL THEN
       RAISE EXCEPTION 'Usuario no encontrado en auth.users con el correo indicado.';
     END IF;

     DELETE FROM public.user_roles
     WHERE user_id = v_user_id AND role = 'admin_global';

     GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

     IF v_deleted_count = 0 THEN
       RAISE NOTICE 'Sin cambios: el usuario % no poseía el rol admin_global.', v_user_id;
     ELSE
       RAISE NOTICE 'Rol admin_global revocado para el usuario %.', v_user_id;
     END IF;
   END $$;
   ```
2. **Efecto inmediato en la aplicación:** Dado que `checkAdminAuthorization` consulta `is_admin()` en tiempo real contra la base de datos sin cachear privilegios en JWT, la revocación surte efecto de forma instantánea en la siguiente interacción del usuario.

---

## 7. Trazabilidad y auditoría del rol (migración 7)

Estado técnico vigente desde la migración `20261020130000_administrative_audit_hardening.sql`:

1. **Trigger automático en `public.user_roles`:**
   - `trg_audit_user_roles` es un trigger `AFTER INSERT OR DELETE` sobre `public.user_roles`.
   - Ejecuta `public.fn_audit_user_roles_mutation()`, definida como `SECURITY DEFINER` con `SET search_path = ''`.
   - No existe trigger de `UPDATE` porque la tabla no admite actualizaciones de rol relevantes: la baja se realiza con `DELETE`.
2. **Eventos registrados en `public.audit_logs`:**
   - **Alta:** `action = 'admin_role_granted'`, `target_table = 'user_roles'`, `target_id = user_id`, `payload = {"role":"admin_global","granted_user_id":"<uuid>"}`.
   - **Baja:** `action = 'admin_role_revoked'`, `target_table = 'user_roles'`, `target_id = user_id`, `payload = {"role":"admin_global","revoked_user_id":"<uuid>"}`.
   - El evento se escribe en la **misma transacción** que la mutación. Si la asignación aborta, el evento no existe; no puede quedar auditoría huérfana.
3. **Identidad del actor:**
   - El trigger usa `auth.uid()`. Cuando la ejecución se realiza desde el **SQL Editor** (o una consola administrativa sin sesión de aplicación), `auth.uid()` es `NULL`.
   - En ese caso queda `actor_type = 'system_or_internal'` y `actor_id = NULL`. **La base de datos no identifica al operador humano.**
   - Cuando existe una sesión autenticada, `actor_type = 'authenticated_user'` y `actor_id` es el UUID de esa sesión. Este no es el canal previsto para el aprovisionamiento.
   - La identidad del operador se acredita mediante el **ticket de cambio** y los **registros de la plataforma** (Platform Audit Trail / logs de infraestructura). No debe inferirse de `audit_logs`.
4. **Registro en el ticket de control de cambios:**
   - beneficiario, `user_id` resuelto, `matching_users`, `email_confirmed`, `already_admin`, baseline aprobado (`admin_count` + `admin_fingerprint`), aprobador y ejecutor;
   - fecha y hora de ejecución;
   - hash del script ejecutado (SHA-256) y, si aplica, commit;
   - comprobación posterior: fila en `user_roles`, evento `admin_role_granted` y ausencia de eventos inesperados;
   - referencia a la ventana de logs de plataforma que acredita al operador y constancia de que los logs fueron efectivamente archivados.
5. **Prohibición de inserciones manuales en `audit_logs`:**
   - No se insertan registros manuales para “simular” trazabilidad. La evidencia es la que produce el trigger.
6. **Baseline y deriva:**
   - La huella `admin_fingerprint` (MD5 de la lista ordenada de `user_id`) es un control de deriva operativa, **no** un hash criptográfico de seguridad.
   - Verifica que el conjunto de administradores no cambió entre la aprobación y la ejecución, e incluye la detección de sustituciones que un conteo simple no advierte.

---

## 8. Prohibición de Exposición en la Aplicación

Para mitigar riesgos de elevación de privilegios:
- Queda terminantemente prohibido crear rutas API (`/api/admin/roles`), Server Actions o funciones RPC que acepten UUIDs y otorguen o modifiquen roles.
- La tabla `public.user_roles` debe permanecer sin permisos (`REVOKE ALL`) para los roles de conexión de la aplicación (`anon`, `authenticated`).
- El único medio válido de otorgamiento de privilegios es el procedimiento administrativo de infraestructura detallado en este documento.
