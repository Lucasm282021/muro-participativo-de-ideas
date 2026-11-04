# Procedimiento Operativo Estándar: Gestión del Rol `admin_global` (H-15 / H-11)

**Proyecto:** Muro Participativo de Ideas  
**Ámbito:** Seguridad, Autorización y Control de Acceso Administrativo  
**Versión:** 1.0.0  
**Fecha de emisión:** 20 de octubre de 2026  
**Clasificación:** Confidencial / Uso Operativo Interno  

---

## 1. Propósito y alcance

Este documento establece el procedimiento técnico y administrativo para la asignación, verificación, auditoría y revocación del rol `admin_global` en la base de datos del Muro Participativo de Ideas.

El kit operativo de infraestructura se compone de tres herramientas versionadas en el directorio `scripts/admin/`:
1. `scripts/admin/check_admin_baseline.sql`: Auditoría y preflight no destructivo de solo lectura para comprobar el esquema, enumerar administradores activos y calcular la huella (*admin_fingerprint*).
2. `scripts/admin/assign_admin_global.sql`: Procedimiento transaccional de alta atómica con guardas defensivas y comprobación de precondiciones.
3. `scripts/admin/revoke_admin_global.sql`: Procedimiento transaccional de revocación segura y acotada con verificación de impacto unitario.

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
3. El UUID del usuario debe obtenerse directamente mediante una consulta de solo lectura sobre `auth.users` dentro de la misma transacción, evitando que un operador tipee o copie manualmente identificadores arbitrarios.

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
- Solicitud formal aprobada según la matriz de separación de responsabilidades (§2).
- Cuenta del usuario creada y confirmada en `auth.users`.
- Acceso del operador a la consola administrativa de Supabase (SQL Editor protegido).
- Ejecución previa satisfactoria del diagnóstico de línea base.

### Pasos de ejecución
1. **Preflight obligatorio (inspección de línea base):**
   - Abrir la consola administrativa SQL.
   - Ejecutar el script de solo lectura `scripts/admin/check_admin_baseline.sql`.
   - Confirmar que los componentes del esquema existan (`table_exists = true`, `function_exists = true`), revisar el listado actual de administradores y registrar el conteo (`admin_count`) previo a la operación.
2. **Carga del script de alta:**
   - Cargar la plantilla transaccional parametrizada `scripts/admin/assign_admin_global.sql`.
3. **Parametrización segura:**
   - Sustituir el marcador de posición obligatorio `PLACEHOLDER_USER_EMAIL` por el correo institucional formal del usuario objetivo.
4. **Ejecución atómica:**
   - Ejecutar el bloque transaccional (`DO $$ ... $$;`).
   - El bloque cuenta con una guarda obligatoria que aborta la transacción si no se reemplaza el marcador de posición `PLACEHOLDER_USER_EMAIL`.
5. **Comprobaciones defensivas integradas:**
   - Valida que exista exactamente un usuario en `auth.users` con el correo indicado. Si no existe o hay ambigüedad, aborta (`RAISE EXCEPTION`).
   - Valida que el usuario no posea ya el rol `admin_global`. Si ya lo posee, aborta con mensaje informativo.
   - Inserta la fila en `public.user_roles (user_id, role) VALUES (target_user_id, 'admin_global')`.
6. **Verificación posterior:**
   - Confirmar la asignación ejecutando la consulta de verificación:
     ```sql
     SELECT ur.user_id, u.email, ur.role, ur.created_at
     FROM public.user_roles ur
     JOIN auth.users u ON u.id = ur.user_id
     WHERE u.email = 'usuario.objetivo@institucion.gob.ar';
     ```
   - Opcionalmente, reejecutar `scripts/admin/check_admin_baseline.sql` para corroborar el incremento neto de 1 administrador en `admin_count` y la nueva huella criptográfica.

---

## 6. Procedimiento de Revocación de Privilegios

La baja de un administrador debe ejecutarse inmediatamente ante cambio de funciones, renuncia o sospecha de compromiso:

### Precondiciones
- Solicitud o reporte formal de baja o revocación.
- Verificación previa del estado actual mediante `scripts/admin/check_admin_baseline.sql`.
- Acceso a la consola administrativa SQL de Supabase.

### Pasos de ejecución
1. **Carga del script de revocación:**
   - Cargar la plantilla transaccional parametrizada `scripts/admin/revoke_admin_global.sql`.
2. **Parametrización segura:**
   - Sustituir el marcador obligatorio `PLACEHOLDER_USER_EMAIL` por el correo del usuario al que se revocarán los privilegios:
     ```sql
     c_target_email CONSTANT text := 'PLACEHOLDER_USER_EMAIL';
     ```
3. **Ejecución y salvaguardas:**
   - Ejecutar el bloque transaccional (`DO $$ ... $$;`).
   - El script aborta inmediatamente si el marcador `PLACEHOLDER_USER_EMAIL` no fue sustituido.
   - Valida que el correo exista en `auth.users`. Si no se localiza la cuenta, aborta con excepción.
   - Realiza un borrado acotado exclusivamente al rol `admin_global` de ese usuario específico:
     ```sql
     DELETE FROM public.user_roles
     WHERE user_id = v_user_id AND role = 'admin_global';
     ```
   - Inspecciona `GET DIAGNOSTICS v_deleted_count = ROW_COUNT` y emite notificación diagnóstica confirmando la revocación efectiva o avisando si el usuario no contaba con el rol.
4. **Verificación posterior:**
   - Ejecutar nuevamente `scripts/admin/check_admin_baseline.sql` para confirmar la disminución del conteo administrativo y la consistencia del esquema.
5. **Efecto inmediato en la aplicación:**
   - Dado que `checkAdminAuthorization` consulta `is_admin()` en tiempo real contra la base de datos sin cachear privilegios en JWT (`fail-closed`), la revocación surte efecto de forma instantánea en la siguiente interacción o solicitud del usuario.

---

## 7. Análisis de Trazabilidad y Limitaciones del Esquema Actual (H-15)

Es imperativo documentar con total transparencia el estado técnico de la base de datos respecto a la auditoría de roles:

1. **Estado en migraciones 1 a 6:**
   - La tabla `public.user_roles` no cuenta con triggers de auditoría automática que inserten en `public.audit_logs`.
   - La tabla `public.audit_logs` posee triggers para mutaciones en `public.activities` y `public.ideas`, pero no para `public.user_roles`.
2. **Principio de no invención:**
   - No se debe insertar manualmente registros simulados en `public.audit_logs` desde scripts de aprovisionamiento, ya que ello no constituye una garantía del motor relacional y podría vulnerar restricciones o semánticas de triggers vigentes.
3. **Trazabilidad en el esquema actual:**
   - Toda ejecución en la consola de Supabase queda registrada en los logs de auditoría de infraestructura de la plataforma Supabase (Postgres logs y Platform Audit Trail).
   - El operador debe registrar en el ticket de control de cambios el `user_id`, fecha, hora y hash del commit del procedimiento ejecutado.
4. **Evolución recomendada (Migración 7):**
   - Si se requiere que las altas y bajas de roles queden reflejadas dentro de la tabla de negocio `public.audit_logs` de forma transaccional, deberá diseñarse formalmente un trigger `AFTER INSERT OR DELETE ON public.user_roles` en la futura Migración 7, asegurando el manejo correcto de actor (`system_or_internal` cuando se ejecute por consola de servicio).

---

## 8. Prohibición de Exposición en la Aplicación

Para mitigar riesgos de elevación de privilegios:
- Queda terminantemente prohibido crear rutas API (`/api/admin/roles`), Server Actions o funciones RPC que acepten UUIDs y otorguen o modifiquen roles.
- La tabla `public.user_roles` debe permanecer sin permisos (`REVOKE ALL`) para los roles de conexión de la aplicación (`anon`, `authenticated`).
- El único medio válido de otorgamiento de privilegios es el procedimiento administrativo de infraestructura detallado en este documento.
