# Informe Institucional de Ejecución: Habilitación del Primer Administrador Global

**Proyecto:** Muro Participativo de Ideas
**Ámbito:** Control de Acceso, Auditoría y Seguridad Institucional
**Fecha de emisión del informe:** 28 de octubre de 2026
**Clasificación:** Confidencial / Uso Operativo Interno

---

## 1. Identificación y Alcance

- **Operación:** Habilitación del primer administrador global en la plataforma.
- **Entorno de destino:** Supabase Producción.
- **Project Ref:** `nsuuufoszqwqerogcdpb`.
- **Identidad beneficiaria autorizada:**
  - **Correo electrónico:** `ldmdesarrollodesoftware@gmail.com`
  - **Identificador de usuario (UUID):** `1e425a26-f9f1-413b-aeb3-f9017f94b46e`
- **Rol concedido:** `admin_global` (tipo enumerado `public.app_role`).
- **Fecha y hora de ejecución registrada:** `2026-10-28 02:40:19.774391+00` (timestamp generado por la base de datos).
- **Autorización de origen:** Autorización expresa y documentada emitida por el responsable del proyecto bajo separación de roles organizacionales.
- **Alcance de la operación:** Estrictamente circunscrito a una única identidad preexistente en el proveedor de autenticación. No incluyó modificaciones de datos en otras cuentas, asignación masiva de roles, cambios en esquemas de tablas, mutaciones de políticas RLS, modificaciones de código de aplicación ni despliegues en infraestructura.

---

## 2. Diagnóstico Previo Inmediato

Con anterioridad inmediata a la ejecución de la escritura, se efectuaron consultas de solo lectura contra la base de datos de producción mediante Supabase CLI vinculada al proyecto `nsuuufoszqwqerogcdpb`, confirmando los siguientes valores de diagnóstico:

- **Coincidencias en `auth.users` (`matching_users`):** `1` (identidad única).
- **Confirmación de correo institucional (`email_confirmed`):** `true` (`email_confirmed_at IS NOT NULL`).
- **Condición previa de rol (`already_admin`):** `false`.
- **Conteo previo de administradores globales (`admin_count`):** `0`.
- **Huella de identidades previa (`admin_fingerprint`):** `d41d8cd98f00b204e9800998ecf8427e` (resultado determinista de `md5('')`).
- **Comprobación previa en interfaz web:** Previo a la asignación, la cuenta objetivo recibía un error HTTP 403 al intentar acceder a la ruta protegida `/admin` en el entorno Dev, debido al control autoritativo estricto en servidor (`src/lib/auth/admin.ts`).

---

## 3. Controles de Seguridad y Diseño Operativo

El procedimiento aplicado se rige por las directivas del documento [docs/admin_role_procedure.md](./admin_role_procedure.md) y se apoya en el script oficial [scripts/admin/assign_admin_global.sql](../scripts/admin/assign_admin_global.sql).

### A. Guardas Lógicas del Script
El script de asignación implementa ocho guardas de validación atómica dentro de un único bloque transaccional `DO $$ ... $$;`:
- `B3C-01`: Validación de correo institucional no vacío y reemplazo del placeholder de configuración.
- `B3C-02`: Validación de aprobación explícita de baseline (conteo y huella no nulos).
- `B3C-03`: Validación contra deriva de conteo de administradores respecto al baseline aprobado.
- `B3C-04`: Validación contra sustitución de identidades mediante huella MD5 determinista (`admin_fingerprint`).
- `B3C-05`: Verificación de existencia del usuario en `auth.users`.
- `B3C-06`: Verificación de unicidad del usuario en `auth.users` (coincidencia exactamente igual a 1).
- `B3C-07`: Validación de correo electrónico efectivamente confirmado (`email_confirmed_at IS NOT NULL`).
- `B3C-N1`: Salvaguarda de idempotencia si la cuenta ya poseía el rol `admin_global` (retorno limpio sin mutación ni eventos duplicados).

*Nota de evidencia y limitación probatoria:* La ejecución del bloque atómico finalizó con código de salida `0` sin emitir excepciones `RAISE EXCEPTION`. Dado que la herramienta CLI en modo no interactivo no capturó la traza de mensajes `NOTICE` (`B3C-N2`), el cumplimiento de las condiciones `B3C-01` a `B3C-07` y la no-activación del retorno temprano `B3C-N1` se infieren formalmente de la finalización limpia del statement y la efectiva inserción de la fila, diferenciando la lógica del control respecto a una traza de log individual por guarda.

### B. Principio de Separación de Funciones y Prohibición de Exposición
- **Canal de ejecución:** Se empleó la consola de infraestructura administrativa mediante Supabase CLI vinculada a producción.
- **Prohibición de autoasignación:** Ningún usuario ordinario puede elevar sus propios privilegios; la tabla `public.user_roles` carece de permisos directos (`REVOKE ALL`) para roles `anon` y `authenticated`.
- **Ausencia de endpoints:** La aplicación web no expone rutas API, Server Actions ni procedimientos remotos para asignar o alterar roles administrativos.

---

## 4. Ejecución y Resultado en Base de Datos

- **Herramienta de ejecución:** Supabase CLI v2.119.0 ejecutada con el parámetro `--linked` contra el proyecto de producción `nsuuufoszqwqerogcdpb`.
- **Código de salida:** `0` (ejecución exitosa).
- **Mutación relacional:** Inserción de exactamente una fila en la tabla `public.user_roles`:
  - `user_id`: `1e425a26-f9f1-413b-aeb3-f9017f94b46e`
  - `role`: `admin_global`
  - `created_at`: `2026-10-28 02:40:19.774391+00`
- **Mutaciones colaterales:** Conforme al alcance restringido del script ejecutado (bloque atómico cerrado sin sentencias DDL ni mutaciones sobre otras entidades), la operación estuvo circunscrita a la tabla `public.user_roles`, manteniéndose inalterados los esquemas, políticas RLS y tablas de datos ajenas a la transacción autorizada.

---

## 5. Evidencia de Auditoría Transaccional

Conforme al mecanismo establecido en la migración [20261020130000_administrative_audit_hardening.sql](../supabase/migrations/20261020130000_administrative_audit_hardening.sql), el disparador `trg_audit_user_roles` registró automáticamente la mutación en la bitácora inmutable `public.audit_logs` dentro de la misma transacción.

Consulta de solo lectura realizada post-ejecución sobre `public.audit_logs`:
```sql
SELECT id, actor_type, action, target_table, target_id, payload, created_at
FROM public.audit_logs
WHERE target_id = '1e425a26-f9f1-413b-aeb3-f9017f94b46e'
ORDER BY created_at DESC LIMIT 1;
```

**Registro de auditoría obtenido:**
- **Identificador del evento (`id`):** `d934566b-ad56-4eef-a1e1-8e42edc80016`
- **Tipo de actor (`actor_type`):** `system_or_internal` (esperado al ejecutarse desde consola administrativa sin sesión interactiva de aplicación).
- **Acción auditada (`action`):** `admin_role_granted`
- **Tabla objetivo (`target_table`):** `user_roles`
- **Identificador del objetivo (`target_id`):** `1e425a26-f9f1-413b-aeb3-f9017f94b46e`
- **Carga útil (`payload`):**
  ```json
  {
    "role": "admin_global",
    "granted_user_id": "1e425a26-f9f1-413b-aeb3-f9017f94b46e"
  }
  ```
- **Fecha y hora (`created_at`):** `2026-10-28 02:40:19.774391+00`

---

## 6. Comprobaciones Posteriores

Se realizaron consultas de verificación de solo lectura inmediatamente posteriores a la asignación, con los siguientes resultados verificables:

1. **Pertenencia efectiva de rol:**
   ```sql
   SELECT EXISTS (
     SELECT 1 FROM public.user_roles
     WHERE user_id = '1e425a26-f9f1-413b-aeb3-f9017f94b46e' AND role = 'admin_global'
   ) AS has_admin_role;
   ```
   - **Resultado observado:** `true`.

2. **Nuevo baseline de administradores globales:**
   ```sql
   SELECT count(*) AS admin_count,
          coalesce(md5(string_agg(user_id::text, ',' order by user_id)), md5('')) AS admin_fingerprint
   FROM public.user_roles WHERE role = 'admin_global';
   ```
   - **`admin_count` observado:** `1`.
   - **`admin_fingerprint` observado:** `3ee58be86e9f2e9f892eb2b1c8eab51e`.
   - **Comprobación determinista:** `md5('1e425a26-f9f1-413b-aeb3-f9017f94b46e') = '3ee58be86e9f2e9f892eb2b1c8eab51e'` (coincidencia exacta).

3. **Verificación funcional de acceso en aplicación:**
   - **Resultado comunicado:** El responsable del proyecto confirmó funcionalmente el acceso exitoso de la cuenta habilitada al panel `/admin` en el entorno web.
   - *Distinción de evidencia:* La pertenencia al rol y el evento de auditoría constituyen evidencia técnica directa verificada en base de datos. La navegación efectiva en la interfaz de usuario constituye una confirmación funcional provista por el operador responsable.

---

## 7. Estado Final y Limitaciones Operativas

- **Conclusión técnica:** La asignación del rol `admin_global` para la cuenta institucional designada concluyó satisfactoriamente, con trazabilidad atómica completa y evidencia inmutable en auditoría.
- **Operación única y no repetible:** Esta operación no debe volver a ejecutarse sobre la misma identidad. La salvaguarda `B3C-N1` garantiza idempotencia ante reintentos accidentales, pero cualquier cambio de administración futuro debe tramitarse como una nueva solicitud formal.
- **Alcance de certificación:** El presente informe certifica la asignación del rol y la persistencia de su auditoría; no constituye una auditoría de seguridad integral de la infraestructura completa ni certifica la totalidad de los flujos secundarios del panel administrativo.
- **Protección de información sensible:** El presente expediente no contiene contraseñas, secretos, tokens JWT de sesión ni claves privadas de infraestructura.
- **Futuras modificaciones:** Toda eventual revocación o nueva designación deberá apegarse estrictamente al procedimiento [docs/admin_role_procedure.md](./admin_role_procedure.md) utilizando las consultas de baseline de [scripts/admin/check_admin_baseline.sql](../scripts/admin/check_admin_baseline.sql).

---

## 8. Referencias Cruzadas

- Procedimiento institucional: [docs/admin_role_procedure.md](./admin_role_procedure.md)
- Script de verificación de baseline: [scripts/admin/check_admin_baseline.sql](../scripts/admin/check_admin_baseline.sql)
- Script transaccional de asignación: [scripts/admin/assign_admin_global.sql](../scripts/admin/assign_admin_global.sql)
- Migración 5 (Autorización y roles): [supabase/migrations/20261018040000_admin_global_authorization.sql](../supabase/migrations/20261018040000_admin_global_authorization.sql)
- Migración 7 (Endurecimiento de auditoría relacional): [supabase/migrations/20261020130000_administrative_audit_hardening.sql](../supabase/migrations/20261020130000_administrative_audit_hardening.sql)
