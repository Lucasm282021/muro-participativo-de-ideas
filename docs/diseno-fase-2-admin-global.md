# Documento de Diseño Técnico — Fase 2: Implementación Operativa y Autorización de `/admin`

**Proyecto:** Muro Participativo de Ideas  
**Rama de trabajo:** `feat/pagina-administracion-from-dev`  
**Estado:** Propuesta documental de diseño final corregida (no implementado, no aplicado, sin cambios en BD).  
**Entorno de aplicación previsto:** Entorno local descartable de desarrollo (API `http://127.0.0.1:25435`, PostgreSQL puerto `25433`, Studio `http://127.0.0.1:25434`).  

---

## 1. Modelo de roles y comprobación de `admin_global` en servidor

### 1.1 Principios de diseño
- **Separación estricta entre Autenticación y Autorización:** La presencia de una sesión válida en `auth.users` acredita la identidad del usuario pero no confiere ningún privilegio administrativo.
- **Modelo de roles mínimos:**
  - `organizer`: Rol implícito para cualquier usuario autenticado. No se almacena en base de datos. Sus permisos se derivan directamente de la titularidad del recurso (`owner_id = (select auth.uid())`).
  - `admin_global`: Único rol elevado explícito. Se gestiona en la tabla relacional `public.user_roles`.
- **Fuente única y autoritativa:** La base de datos relacional es la única fuente de verdad sobre el rol. No se utilizan claims en el JWT de Supabase Auth, cookies de cliente, variables de entorno públicas (`NEXT_PUBLIC_*`), ni listas de correos electrónicos en el código.
- **Comprobación fresca obligatoria:** Tanto las rutas de servidor (`/admin/**`) como cada Server Action administrativa deben consultar de forma directa y fresca la base de datos para verificar la titularidad de `admin_global` antes de procesar cualquier lectura global o mutación. Si el rol es revocado en la base de datos, las peticiones subsiguientes del usuario deben ser rechazadas de inmediato sin depender de la expiración del token JWT.
- **Configuración de rutas dinámicas:** Los layouts y páginas bajo `src/app/admin/` deben declarar explícitamente `export const dynamic = "force-dynamic";` para evitar cualquier almacenamiento en caché estático de Next.js en rutas de administración.

---

## 2. Diseño propuesto de migración SQL para roles y autorización

> [!IMPORTANT]
> Este script es una propuesta técnica de diseño. **No debe crearse como archivo de migración ni ejecutarse contra ninguna base de datos sin autorización explícita e independiente.**

### 2.1 Archivo propuesto
`supabase/migrations/<timestamp>_admin_global_authorization.sql`

### 2.2 Estructura DDL propuesta
```sql
-- 1. Tipo enumerado para roles de sistema
create type public.app_role as enum ('admin_global');

-- 2. Tabla de asignación de roles
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now()
);

-- 3. Blindaje de seguridad en public.user_roles
alter table public.user_roles enable row level security;

-- Revocar cualquier acceso directo de los roles de cliente
revoke all on table public.user_roles from public, anon, authenticated;

-- 4. Función de verificación de privilegios (Security Definer)
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

-- Restricción de ejecución de la función autorizadora
revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;
```

---

## 3. Políticas RLS y combinación de reglas permisivas

### 3.1 Mecánica de evaluación en PostgreSQL (Lógica `OR`)
En PostgreSQL, múltiples políticas RLS permisivas aplicables al mismo comando (`SELECT`, `UPDATE`, `DELETE`) y rol (`authenticated`) se combinan mediante el operador lógico **`OR`**. 

Cualquier nueva política administrativa debe revisarse en conjunto con los privilegios SQL (`GRANT`) preexistentes:
- En `20261002080804_initial_data_model.sql` (línea 97), se otorgó `grant select, insert, update, delete on table public.activities to authenticated;`.
- La política existente para organizadores es:
  `using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))`.
- Al agregar la política administrativa:
  `using (public.is_admin()) with check (public.is_admin())`, la condición efectiva para `authenticated` resulta:
  `(owner_id = auth.uid()) OR (public.is_admin())`.

Para un organizador ordinario, `public.is_admin()` evalúa a `false`, por lo que su acceso se mantiene estrictamente restringido a sus propios registros.

### 3.2 Políticas aditivas para `public.activities`
```sql
-- Lectura global de actividades (incluye borradores, abiertas y cerradas)
create policy "Admins can read all activities"
  on public.activities
  for select
  to authenticated
  using (public.is_admin());

-- Actualización administrativa de actividades (cierre, reapertura, modo moderación)
create policy "Admins can update all activities"
  on public.activities
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Eliminación administrativa de actividades
create policy "Admins can delete all activities"
  on public.activities
  for delete
  to authenticated
  using (public.is_admin());
```

### 3.3 Políticas aditivas para `public.ideas`
```sql
-- Lectura global de ideas (pendientes, publicadas y ocultas)
create policy "Admins can read all ideas"
  on public.ideas
  for select
  to authenticated
  using (public.is_admin());

-- Moderación administrativa de ideas (publicar u ocultar)
create policy "Admins can moderate all ideas"
  on public.ideas
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Eliminación administrativa de ideas
create policy "Admins can delete all ideas"
  on public.ideas
  for delete
  to authenticated
  using (public.is_admin());
```

### 3.4 Políticas de solo lectura para auditoría y contexto
```sql
-- Consulta de participantes de cualquier actividad
create policy "Admins can read all participants"
  on public.participants
  for select
  to authenticated
  using (public.is_admin());

-- Consulta de vinculación de autoría para auditoría de contenido
create policy "Admins can read all idea authors"
  on public.idea_authors
  for select
  to authenticated
  using (public.is_admin());
```

---

## 4. Inmutabilidad de `activities.owner_id` y protección contra escalada

### 4.1 Problema de seguridad identificado
Dado que `authenticated` posee `GRANT UPDATE` sobre la tabla `public.activities`, la política RLS administrativa `with check (public.is_admin())` evaluaría a `true` ante un `UPDATE` administrativo aun si este incluye un cambio en la columna `owner_id`. Esto permitiría la reasignación indebida de la titularidad de una actividad ajena.

### 4.2 Solución adoptada: Trigger de inmutabilidad en PostgreSQL
Para blindar esta restricción a nivel de integridad de datos en el motor relacional, se establece un trigger `BEFORE UPDATE` que rechace de manera absoluta cualquier intento de modificación de `owner_id`:

```sql
create or replace function public.prevent_activity_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'El campo owner_id es inmutable y no puede ser modificado'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger activities_prevent_owner_change
  before update on public.activities
  for each row
  execute function public.prevent_activity_owner_change();
```

### 4.3 Límites de la protección y distinción de capas
- **Alcance del trigger:** Es una regla de integridad de datos. Impide físicamente alterar el valor de `owner_id`, sin importar qué rol SQL o qué usuario ejecute la sentencia.
- **Distinción respecto de la autorización:** El trigger no autoriza la operación; solo salvaguarda la inmutabilidad de la columna. La autorización de *quién* puede actualizar los restantes campos (`status`, `moderation_mode`, `title`, `question`) recae exclusivamente en la combinación de RLS (`public.is_admin()`) y la validación en las Server Actions.

---

## 5. Server Actions operativas para la Fase 2

Las Server Actions administrativas se ubicarán en `src/app/admin/actions.ts` (o debidamente segregadas en `src/app/actions.ts`), adhiriéndose estrictamente al contrato de respuesta de la aplicación y aplicando el patrón de doble barrera (validación de servidor + enforcement RLS en PostgreSQL).

### 5.1 Contrato uniforme de respuesta y helper de autorización
Las Server Actions **nunca deben lanzar excepciones no controladas** (`throw new Error`), ya que en producción Next.js oculta el mensaje con un digest genérico. Deben retornar el tipo estándar `FormState`:

```typescript
export type FormState = { error?: string; success?: string };

export type AdminAuthResult =
  | { authorized: true; user: User }
  | { authorized: false; error: string };

export async function checkAdminAuthorization(supabase: SupabaseClient): Promise<AdminAuthResult> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { authorized: false, error: "No se identificó una sesión activa." };
  }

  // Consulta fresca autoritativa a la función SQL
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  if (roleError || !isAdmin) {
    return { authorized: false, error: "Acceso denegado: se requieren permisos de administración global." };
  }

  return { authorized: true, user };
}
```

### 5.2 Moderación de ideas (`adminModerateIdeaAction`)
- **Contrato:** `async function adminModerateIdeaAction(formData: FormData): Promise<FormState>`
- **Esquema de validación Zod:**
  ```typescript
  const adminModerateIdeaSchema = z.object({
    ideaId: z.string().uuid("Identificador de idea inválido."),
    activityId: z.string().uuid("Identificador de actividad inválido."),
    status: z.enum(["published", "hidden"], { message: "Estado de moderación inválido." }),
  });
  ```
- **Reglas de negocio vigentes:**
  1. Comprobar autorización mediante `checkAdminAuthorization()`. Si falla, retornar `{ error: auth.error }`.
  2. Validar existencia de la idea en `public.ideas`.
  3. **Idempotencia:** Si el estado actual ya coincide con el solicitado, retornar `{ success: "La idea ya se encuentra en el estado solicitado." }` sin mutación innecesaria.
  4. La actualización atómica de `published_at` es ejecutada por el trigger preexistente `ideas_update_published_at` (`now()` al publicar, `null` al ocultar).
  5. Revalidar las rutas afectadas mediante `revalidatePath`.

### 5.3 Cierre y reapertura de actividades (`adminToggleActivityAction`)
- **Contrato:** `async function adminToggleActivityAction(formData: FormData): Promise<FormState>`
- **Esquema de validación Zod:**
  ```typescript
  const adminToggleActivitySchema = z.object({
    activityId: z.string().uuid("Identificador de actividad inválido."),
    status: z.enum(["open", "closed"], { message: "Estado de actividad inválido." }),
  });
  ```
- **Reglas de negocio vigentes:**
  1. Comprobar autorización administrativa fresca.
  2. Validar existencia de la actividad.
  3. Transición a `'closed'`: asigna `closed_at = now()`. Impide la recepción de nuevas ideas.
  4. Transición a `'open'`: asigna `opened_at = now()` y restablece `closed_at = null`.
  5. Capturar errores de base de datos y retornar `{ error: "No se pudo actualizar el estado de la actividad." }`.

### 5.4 Eliminación de actividades y tratamiento de cascada (`adminDeleteActivityAction`)
- **Contrato:** `async function adminDeleteActivityAction(_prev: FormState, formData: FormData): Promise<FormState>`
- **Esquema de validación Zod:**
  ```typescript
  const adminDeleteActivitySchema = z.object({
    activityId: z.string().uuid("Identificador de actividad inválido."),
    confirmationCode: z.string().trim().length(8, "El código de confirmación debe tener exactamente 8 caracteres."),
  });
  ```
- **Dependencias reales identificadas en el esquema:**
  En las migraciones vigentes ([20261002080804_initial_data_model.sql](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/supabase/migrations/20261002080804_initial_data_model.sql)), las tablas vinculadas mediante clave foránea en cascada hacia `activities` son exclusivamente:
  1. `public.participants` (`activity_id references public.activities(id) on delete cascade`)
  2. `public.ideas` (`activity_id references public.activities(id) on delete cascade`)
  3. `public.idea_authors` (`(activity_id, idea_id)` y `(activity_id, participant_id)` en cascada).
- **Barrera de seguridad obligatoria contra borrado accidental:**
  - El usuario debe ingresar en el formulario el código público (`public_code`) de la actividad a eliminar.
  - La Server Action consulta la actividad y comprueba en el servidor:
    ```typescript
    if (activity.public_code !== parsed.data.confirmationCode) {
      return { error: "El código de confirmación no coincide con el código público de la actividad." };
    }
    ```
  - **Aclaración de seguridad:** La validación del código público es un mecanismo para evitar accidentes operativos; **no sustituye ni equivale a la autorización administrativa**, la cual se valida previamente con `checkAdminAuthorization()`.

---

## 6. Auditoría transaccional de operaciones sensibles

### 6.1 Problema de atomicidad y pérdida silenciosa de eventos
Si el registro de auditoría se efectúa mediante una llamada separada desde la Server Action, cualquier interrupción de red o fallo de ejecución provocará que la mutación se aplique sin que se registre el evento (problema de doble escritura sin transacción distribuida). Por ello, la bitácora debe ejecutarse dentro de la misma transacción relacional en PostgreSQL.

### 6.2 Tabla de bitácora y políticas de inmutabilidad (`public.audit_logs`)
```sql
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  actor_type varchar(30) not null default 'authenticated_user',
  action varchar(50) not null,
  target_table varchar(50) not null,
  target_id uuid not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Inmutabilidad estricta contra roles de cliente
alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from public, anon, authenticated;
grant select on table public.audit_logs to authenticated; -- solo lectura para panel de auditoría futuro
```

#### Reglas de identificación del actor y snapshot de identidad:
1. **Contexto de usuario verificable:** Cuando la mutación se ejecuta mediante el cliente web con sesión activa, el campo `actor_id` se asigna mediante `(select auth.uid())` y `actor_type` se establece en `'authenticated_user'`.
2. **Snapshot histórico inmutable (`actor_id_snapshot`):** En todos los eventos auditados, el payload JSONB incluye `'actor_id_snapshot', current_actor_id`. Si la cuenta del usuario es posteriormente eliminada de `auth.users`, la clave foránea relacional (`references auth.users(id) on delete set null`) fija `actor_id = NULL`, pero el documento JSONB preserva el snapshot del UUID de forma inmutable.
3. **Operaciones sin contexto de usuario:** Si la operación se realiza en un contexto donde `auth.uid()` es `NULL` (scripts de mantenimiento local, migraciones o consola SQL de administración), el campo `actor_id` y `actor_id_snapshot` se almacenan estrictamente como `NULL` (sin inventar UUIDs artificiales) y `actor_type` se registra como `'system_or_internal'`.
4. **Minimización estricta de datos:** El snapshot almacena únicamente el identificador UUID opaco. No se registran correos electrónicos, nombres, direcciones IP ni datos de carácter personal en el payload de auditoría.
5. **Naturaleza del UUID y límites de seguridad:**
   - El UUID capturado constituye una **referencia histórica de correlación relacional**, **no una prueba criptográfica de identidad** ni un mecanismo de no-repudio asistido por firma digital o sellado de tiempo criptográfico.
   - **Límites de protección contra roles de infraestructura:** Revocar `UPDATE` y `DELETE` a `anon` y `authenticated` protege la bitácora contra peticiones originadas en la aplicación o clientes API. No obstante, superusuarios (`postgres`), credenciales privilegiadas (`service_role`) o acceso root al contenedor pueden modificar o alterar los registros de auditoría si la infraestructura resulta comprometida.

---

### 6.3 Auditoría transaccional de actividades (`public.activities`)

#### Especificación de la función trigger:
```sql
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
```

#### Vinculación explícita del trigger:
```sql
create trigger trg_audit_activities_mutation
  after update or delete on public.activities
  for each row
  execute function public.audit_activity_mutation();
```

- **Justificación del momento `AFTER`:** Ejecutar en `AFTER` garantiza que todos los triggers `BEFORE` (en particular `activities_prevent_owner_change`) ya validaron exitosamente la fila, asegurando que solo se auditan operaciones que cumplieron todas las restricciones de integridad. Al formar parte de la misma transacción, si la inserción en `public.audit_logs` falla, la mutación completa en `activities` se revierte automáticamente.

---

### 6.4 Auditoría transaccional de moderación de ideas (`public.ideas`)

#### Especificación de la función trigger:
```sql
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
```

#### Vinculación explícita del trigger:
```sql
create trigger trg_audit_ideas_mutation
  after update of status or delete on public.ideas
  for each row
  execute function public.audit_idea_mutation();
```

- **Justificación del momento `AFTER`:** En `public.ideas`, el trigger preexistente `ideas_update_published_at` es un trigger `BEFORE UPDATE OF status`. Ejecutar `trg_audit_ideas_mutation` en `AFTER` garantiza que `new.published_at` ya ha sido calculado y fijado atómicamente (`now()` al publicar o `null` al ocultar), registrando con exactitud el estado final consolidado.
- **Minimización de datos en el payload:** Para cumplir con los principios de privacidad y evitar volcar textos completos en la bitácora relacional de auditoría, se registran metadatos operativos (`activity_id`, `status`, fechas, longitud del contenido) sin duplicar datos innecesarios.

---

### 6.5 Alcance de la auditoría en eliminaciones en cascada

#### Comparación de enfoques:
1. **Opción A — Registro individual de cada fila dependiente eliminada:**
   - *Impacto:* Si una actividad posee 5.000 ideas y 2.000 participantes, un `DELETE` en cascada ejecutaría 7.001 inserciones dentro de una sola transacción. Esto provocaría contención de bloqueos (*lock contention*), riesgo de timeout en la conexión y bloat severo en `audit_logs`, además de duplicar en la bitácora datos personales de participantes (`email`, `first_name`, `last_name`).
2. **Opción B — Registro consolidado a nivel de actividad (Estrategia adoptada):**
   - *Impacto:* Transacción atómica ultrarrápida, previene la amplificación de escrituras (*write amplification*) y salvaguarda la privacidad de los participantes.

#### Especificación técnica del alcance adoptado:
- **Evento principal registrado:** La eliminación de la actividad genera un evento `activity_delete` que registra la destrucción del contenedor raíz con su identificador, código público, título y titularidad.
- **Tratamiento de dependencias hijas (`participants`, `ideas`, `idea_authors`):**
  - **Aclaración inequívoca:** Un trigger sobre `public.activities` **no captura automáticamente los detalles de las filas hijas**. PostgreSQL procesa la cláusula `ON DELETE CASCADE` internamente a nivel de motor.
  - Para las dependencias hijas `public.participants` e `public.idea_authors`, no se activan triggers individuales de auditoría para no almacenar listas masivas de correos o enlaces de autoría en la bitácora.
  - Para `public.ideas`, si se requiere auditoría de borrado individual, el trigger `trg_audit_ideas_mutation` sobre `public.ideas` registrará cada idea borrada de forma compacta (sin PII); alternativamente, para evitar la sobrecarga masiva en cascadas grandes, el Server Action puede recopilar un recuento cuantitativo (`total_ideas_deleted`, `total_participants_deleted`) en el momento previo a la llamada de eliminación.

---

## 7. Matriz de pruebas en Dev (Datos sintéticos)

Las pruebas deben ejecutarse exclusivamente en el entorno local aislado con datos sintéticos:

| Identidad sintética | Correo de prueba | Rol en BD | Propósito |
|---|---|---|---|
| **Usuario A** | `admin.test@synthetic.local` | `admin_global` en `public.user_roles` | Pruebas de acceso y mutaciones autorizadas. |
| **Usuario B** | `organizer1.test@synthetic.local` | Sin rol (organizador) | Dueño de Actividad 1. Verificación de aislamiento. |
| **Usuario C** | `organizer2.test@synthetic.local` | Sin rol (organizador) | Dueño de Actividad 2. Detección de interferencia. |
| **Usuario D** | *(Sin sesión / Anónimo)* | `anon` | Verificación de rechazo a accesos públicos. |

### Casos de prueba previstos:
1. `SEC-NEG-01` (Acceso anónimo): Usuario D intenta consultar `/admin` o invocar Server Actions -> Bloqueo con redirección o `{ error: "No autorizado" }`.
2. `SEC-NEG-02` (Escalada de organizador): Usuario B intenta invocar `adminToggleActivityAction` sobre la Actividad 2 de Usuario C -> Rechazado por validación de rol y bloqueado por RLS.
3. `SEC-POS-01` (Lectura global admin): Usuario A accede a `/admin` y visualiza métricas consolidadas y actividades de B y C.
4. `SEC-POS-02` (Ciclo de vida de actividad): Usuario A cierra y reabre la Actividad 1 de Usuario B -> Mutación exitosa; `closed_at` y `opened_at` coherentes; evento `activity_status_change` confirmado en `audit_logs`.
5. `SEC-POS-03` (Moderación global de ideas): Usuario A oculta y luego publica una idea en la Actividad 1 -> Mutación exitosa; sincronización de `published_at`; evento `idea_moderate_status` confirmado en `audit_logs`.
6. `SEC-POS-04` (Integridad de cascada): Usuario A elimina una actividad de prueba validando su código público -> Cascada limpia de participantes, ideas y autores; evento `activity_delete` registrado en `audit_logs`.
7. `SEC-FRESH-01` (Revocación inmediata): Se elimina el rol de Usuario A en `public.user_roles` con una sesión abierta -> La siguiente petición o Server Action es denegada inmediatamente sin requerir reautenticación.
8. `SEC-REG-01` (No regresión del organizador): Usuario B crea, edita y modera sus propias actividades en `/panel` tras aplicar la migración -> Operaciones habituales continúan funcionando normalmente.

---

## 8. Separación de credenciales y datos respecto de producción

1. **Aislamiento de infraestructura:** Todas las pruebas y verificaciones deben realizarse en la instancia local de Supabase (API `http://127.0.0.1:25435`, PostgreSQL en puerto `25433`, Studio en `http://127.0.0.1:25434`), nunca en el proyecto de producción.
2. **Precauciones ante vínculo remoto en CLI:** La presencia de `supabase/.temp/project-ref` exige extremar precauciones (prohibición de `supabase db push`, `db remote *` o banderas `--linked`), si bien su existencia no demuestra por sí sola que las conexiones locales apunten a producción. La verificación de aislamiento se efectúa consultando directamente `SELECT inet_server_port();` (`25433`).
3. **Prohibición de credenciales de producción:**
   - La rama de producción `Main` y la base de datos de producción están totalmente excluidas del alcance.
   - Ninguna clave de servicio (`SUPABASE_SERVICE_ROLE_KEY`) de producción debe estar presente ni utilizarse en el código de la aplicación.
4. **Precondición de verificación previa a pruebas:** Antes de ejecutar cualquier script o prueba en el entorno de desarrollo, debe comprobarse que las variables de entorno apunten estrictamente a la URL local:
   `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:25435`.

---

## 9. Procedimiento de revisión y autorización previa a la migración

Antes de aplicar cualquier cambio en base de datos o implementar las Server Actions operativas:

1. **Aprobación de la arquitectura:** El usuario debe revisar y aprobar este documento de diseño corregido.
2. **Revisión del código DDL:** El archivo de migración generado debe ser revisado estáticamente mediante `git diff` antes de su aplicación local.
3. **Autorización explícita:** Solicitar autorización independiente antes de ejecutar comandos de migración (`supabase migration up` o `supabase db reset`).
4. **Verificación de no regresión:** Comprobar que los paneles existentes (`/panel`, `/panel/actividad/[id]`) continúan operando normalmente.

---

## 10. Estado de decisiones técnicas

### Decisiones técnicas resueltas documentalmente:
- **Decisión 1 (Inmutabilidad de `owner_id`): RESUELTA.** Se adopta un Trigger `BEFORE UPDATE` en `public.activities`. Garantiza integridad absoluta a nivel de motor, es independiente de variaciones en PostgREST y no depende de la granularidad de privilegios de columna.
- **Decisión 2 (Arquitectura de bitácora transaccional): RESUELTA.** Se especifican triggers `AFTER UPDATE OR DELETE` tanto en `public.activities` como en `public.ideas`. Se garantiza atomicidad transaccional absoluta (la mutación y su log se confirman o revierten juntos).
- **Decisión 3 (Manejo de operaciones sin usuario en auditoría): RESUELTA.** Se establece `actor_id = NULL` y `actor_type = 'system_or_internal'` cuando `auth.uid()` no esté presente. Queda prohibido atribuir una identidad no verificada.
- **Decisión 4 (Alcance de auditoría en cascadas): RESUELTA.** Se adopta auditoría consolidada a nivel de actividad para prevenir amplificación de escrituras y proteger la privacidad de los participantes, documentando explícitamente que los triggers sobre la tabla raíz no capturan filas dependientes de forma automática.
- **Decisión 5 (Contrato y manejo de errores de Server Actions): RESUELTA.** Se adopta el tipo estándar `{ error?: string; success?: string }` (`FormState`) con helper de verificación controlada, evitando excepciones no capturadas en producción.
- **Decisión 6 (Barrera de eliminación destructiva): RESUELTA.** Se exige la validación en el servidor del código público de la actividad (`confirmationCode === activity.public_code`).

### Verificaciones empíricas pendientes (requieren ejecución en Dev tras autorización):
- **Verificación empírica 1:** Medir la latencia de ejecución de `is_admin()` dentro de las políticas RLS durante consultas concurrentes en el contenedor local de PostgreSQL.
- **Verificación empírica 2:** Confirmar el tiempo de respuesta del borrado en cascada en `public.activities` y de los triggers de auditoría con conjuntos de datos sintéticos de prueba.
