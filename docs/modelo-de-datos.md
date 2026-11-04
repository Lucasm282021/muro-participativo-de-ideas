# Modelo de datos relacional y arquitectura de almacenamiento

Este documento describe la arquitectura relacional, entidades, restricciones de integridad, políticas de seguridad a nivel de fila (RLS), funciones transaccionales y disparadores definidos en el repositorio para el proyecto **Muro Participativo de Ideas**.

---

> [!WARNING]
> ### Distinción obligatoria sobre entornos y estado de despliegue en Supabase
> 1. **DDL versionado en repositorio:** Corresponde a los 9 archivos SQL presentes en el directorio `supabase/migrations/` en la rama `main`.
> 2. **Estado documentado en este archivo:** Proporciona la especificación técnica integral de todo el catálogo relacional versionado, diferenciando con precisión el **núcleo fundacional del MVP (Migraciones 1 a 4)** de las **extensiones administrativas, de auditoría y exportación de Fase 2 (Migraciones 5 a 9)**.
> 3. **Estado aplicado en Supabase Cloud:** **Permanece sin verificar mediante inspección directa en vivo.** Las migraciones 5, 7 y 9 declaran expresamente en sus encabezados que fueron redactadas como propuestas técnicas de revisión que *no deben aplicarse ni ejecutarse en entornos compartidos o producción sin autorización explícita e independiente*. Por tanto, este documento **no afirma** que las migraciones 5 a 9 estén aplicadas en la base de datos de producción, ni tampoco afirma que no lo estén. No debe interpretarse esta especificación como una certificación de despliegue ni como una orden de ejecución sobre la infraestructura activa.

---

## 1. Mapa de Entidades y Relaciones

El catálogo relacional se organiza en dos dominios complementarios: el núcleo operativo del MVP y las extensiones transaccionales de administración y auditoría de Fase 2.

```mermaid
erDiagram
    %% Dominio Núcleo MVP
    AUTH_USERS ||--o{ ACTIVITIES : "organiza (owner_id)"
    ACTIVITIES ||--o{ PARTICIPANTS : "registra"
    ACTIVITIES ||--o{ IDEAS : "recibe"
    IDEAS ||--|| IDEA_AUTHORS : "atribuye (1 a 1)"
    PARTICIPANTS ||--o{ IDEA_AUTHORS : "escribe"

    %% Dominio Extensiones Fase 2 (Propuestas Técnicas)
    AUTH_USERS ||--o| USER_ROLES : "asigna rol (user_id)"
    AUTH_USERS ||--o{ AUDIT_LOGS : "ejecuta accion (actor_id)"
    ACTIVITIES ||--o{ AUDIT_LOGS : "objeto de auditoria"
    IDEAS ||--o{ AUDIT_LOGS : "objeto de auditoria"
    ACTIVITIES ||--o{ AUDIT_CASCADE_CONTEXT : "contexto transaccional C5"

    AUTH_USERS {
        uuid id PK
    }

    ACTIVITIES {
        uuid id PK
        uuid owner_id FK "Inmutable tras creacion"
        varchar public_code UK "8 caracteres alfanumericos"
        varchar title "1-120 caracteres"
        varchar question "1-300 caracteres"
        activity_status status "draft | open | closed"
        moderation_mode moderation_mode "automatic | approval"
        timestamptz created_at
        timestamptz opened_at
        timestamptz closed_at
    }

    PARTICIPANTS {
        uuid id PK
        uuid activity_id FK
        varchar first_name "1-100 caracteres"
        varchar last_name "1-100 caracteres"
        varchar email "Normalizado a minusculas"
        timestamptz created_at
    }

    IDEAS {
        uuid id PK
        uuid activity_id FK
        varchar content "1-500 caracteres"
        idea_status status "pending | published | hidden"
        timestamptz created_at
        timestamptz published_at
    }

    IDEA_AUTHORS {
        uuid idea_id PK_FK "1 a 1 con ideas"
        uuid activity_id FK "FK compuesta"
        uuid participant_id FK "FK compuesta"
        timestamptz created_at
    }

    USER_ROLES {
        uuid user_id PK_FK "references auth.users"
        app_role role "admin_global"
        timestamptz created_at
    }

    AUDIT_LOGS {
        uuid id PK
        uuid actor_id FK "references auth.users ON DELETE SET NULL"
        varchar actor_type "authenticated_user | system_or_internal"
        varchar action "Accion transaccional auditada"
        varchar target_table "activities | ideas | user_roles"
        uuid target_id "ID de entidad afectada"
        jsonb payload "Metadatos y snapshots del evento"
        timestamptz created_at
    }

    AUDIT_CASCADE_CONTEXT {
        uuid activity_id PK
        bigint tx_id PK "txid_current()"
        integer ideas_count "Filas subordinadas"
        integer participants_count "Filas subordinadas"
        integer idea_authors_count "Filas subordinadas"
        timestamptz created_at
    }
```

---

## PARTE I: Modelo Núcleo del MVP (Migraciones 1 a 4)

El núcleo del modelo MVP implementa el flujo de creación de actividades, registro anónimo por evento de participantes, persistencia de ideas públicas y protección estricta de datos personales mediante el desacoplamiento de autoría.

### 2. Entidades del Núcleo MVP

#### 2.1. `public.activities`
Representa una dinámica o muro participativo creado por un organizador autenticado.
- **Campos principales:**
  - `id`: Identificador único UUID (`gen_random_uuid()`).
  - `owner_id`: Clave foránea que referencia a `auth.users(id)` con `ON DELETE CASCADE`.
  - `public_code`: Código alfanumérico público único de 8 caracteres en mayúsculas (`CHECK (public_code ~ '^[A-Z0-9]{8}$')`).
  - `title`: Título de la actividad (`varchar(120)`, no vacío tras trim).
  - `question`: Pregunta disparadora o consigna (`varchar(300)`, no vacía tras trim).
  - `status`: Estado del ciclo de vida (`public.activity_status`: `'draft'`, `'open'`, `'closed'`), por defecto `'draft'`.
  - `moderation_mode`: Modo de moderación (`public.moderation_mode`: `'automatic'`, `'approval'`), por defecto `'automatic'`.
  - `created_at`: Marca temporal de creación (`timestamptz`, por defecto `now()`).
  - `opened_at` / `closed_at`: Marcas de apertura y cierre formal.
- **Índices y restricciones:**
  - Clave primaria sobre `id`.
  - Restricción de unicidad sobre `public_code`.
  - Índice `activities_owner_created_at_idx` sobre `(owner_id, created_at desc)`.

#### 2.2. `public.participants`
Registra la identidad de un participante exclusivamente en el ámbito de una actividad determinada.
- **Campos principales:**
  - `id`: UUID identificador (`gen_random_uuid()`).
  - `activity_id`: Referencia foránea a `public.activities(id)` con `ON DELETE CASCADE`.
  - `first_name`: Nombre (`varchar(100)`, longitud 1 a 100 caracteres tras trim).
  - `last_name`: Apellido (`varchar(100)`, longitud 1 a 100 caracteres tras trim).
  - `email`: Correo electrónico (`varchar(254)`), normalizado a minúsculas mediante `CHECK (email = lower(btrim(email)) AND position('@' in email) > 1 AND char_length(email) <= 254)`.
  - `created_at`: Marca temporal de registro.
- **Restricciones de unicidad:**
  - Clave primaria sobre `id`.
  - `participants_activity_email_key`: Clave única compuesta `(activity_id, email)` que previene duplicación de participantes dentro de una misma actividad.
  - `participants_activity_id_id_key`: Clave única compuesta `(activity_id, id)` utilizada como destino de claves foráneas compuestas.

#### 2.3. `public.ideas`
Almacena el contenido textual de las ideas enviadas por los participantes.
- **Campos principales:**
  - `id`: UUID identificador (`gen_random_uuid()`).
  - `activity_id`: Referencia foránea a `public.activities(id)` con `ON DELETE CASCADE`.
  - `content`: Texto de la idea (`varchar(500)`, longitud 1 a 500 caracteres tras trim).
  - `status`: Estado de moderación (`public.idea_status`: `'pending'`, `'published'`, `'hidden'`), por defecto `'pending'`.
  - `created_at`: Marca temporal de inserción.
  - `published_at`: Marca temporal en que la idea pasó a estado visible (`published`).
- **Privacidad y diseño por omisión:**
  - La tabla `ideas` **no contiene columnas de usuario, participante, nombre ni correo electrónico**.
  - Esta omisión deliberada garantiza que la replicación lógica y las transmisiones de Supabase Realtime no transporten datos personales hacia los navegadores que observan la pantalla pública.
- **Índices y restricciones:**
  - Clave primaria sobre `id`.
  - Restricción única compuesta `ideas_activity_id_id_key` sobre `(activity_id, id)`.
  - Índice `ideas_activity_status_created_at_idx` sobre `(activity_id, status, created_at desc)`.
  - Replicación y Realtime: `REPLICA IDENTITY FULL` configurada y tabla añadida a la publicación `supabase_realtime`.

#### 2.4. `public.idea_authors`
Tabla de desacoplamiento de privacidad que vincula de manera estrictamente confidencial cada idea con su participante emisor.
- **Campos principales:**
  - `activity_id`: UUID de la actividad.
  - `idea_id`: UUID de la idea. Es **clave primaria** (garantizando cardinalidad estricta 1 a 1: cada idea posee un único autor).
  - `participant_id`: UUID del participante emisor.
  - `created_at`: Marca temporal del vínculo.
- **Claves foráneas compuestas de aislamiento:**
  - `idea_authors_activity_idea_fkey`: Referencia compuesta `(activity_id, idea_id)` $\to$ `ideas(activity_id, id)` con `ON DELETE CASCADE`.
  - `idea_authors_activity_participant_fkey`: Referencia compuesta `(activity_id, participant_id)` $\to$ `participants(activity_id, id)` con `ON DELETE CASCADE`.
  - Estas claves compuestas impiden a nivel de motor asociar una idea de una actividad con un participante de otra.
- **Índices:**
  - Índice `idea_authors_activity_participant_idx` sobre `(activity_id, participant_id)`.

---

### 3. Disparadores y Reglas Automáticas del Núcleo MVP

El ciclo de vida de las ideas está gobernado por dos funciones de disparador en `public.ideas`:

1. **`public.set_initial_idea_status()`** (`BEFORE INSERT ON public.ideas`):
   - Consulta el estado y modo de la actividad (`SELECT moderation_mode, status FROM activities WHERE id = new.activity_id FOR SHARE`).
   - Verifica que la actividad esté abierta (`status = 'open'`); si está cerrada o en borrador, aborta la transacción con excepción `check_violation` (*"Activity is not open for submissions"*).
   - Si `moderation_mode = 'automatic'`, asigna automáticamente `new.status := 'published'` y `new.published_at := now()`.
   - Si `moderation_mode = 'approval'`, asigna `new.status := 'pending'` y `new.published_at := null`.
2. **`public.update_idea_published_at()`** (`BEFORE UPDATE OF status ON public.ideas`):
   - Si el nuevo estado es `'published'` y el anterior no lo era, fija `new.published_at := now()`.
   - Si el estado pasa a ser distinto de `'published'` (por ejemplo, `'hidden'`), fija `new.published_at := null`.
   - En cualquier otra transición conserva el valor previo.

---

### 4. Seguridad a Nivel de Fila (RLS) y Matriz de Permisos del MVP

Todas las tablas poseen Row Level Security activado (`ENABLE ROW LEVEL SECURITY`). Los permisos SQL y las políticas se configuran de forma defensiva:

| Tabla | Rol PostgREST | Columnas autorizadas | Operaciones permitidas | Política RLS aplicada |
| :--- | :--- | :--- | :---: | :--- |
| **`activities`** | `anon` | `id, public_code, title, question, status, created_at, opened_at, closed_at` (sin `owner_id`) | `SELECT` | `status in ('open', 'closed')`. *(Restringida estrictamente al rol `anon` en Migración 3, para aislar la lectura pública sin solapar con usuarios autenticados).* |
| **`activities`** | `authenticated` | Todas las columnas | `SELECT, INSERT, UPDATE, DELETE` | `owner_id = (select auth.uid())`. El organizador administra exclusivamente sus propias actividades. |
| **`participants`**| `anon` | Ninguna | Ninguna (`REVOKE ALL`) | No accesible públicamente. Los datos de contacto no se exponen a clientes anónimos. |
| **`participants`**| `authenticated` | Todas las columnas | `SELECT` | Subconsulta de titularidad: la actividad padre debe pertenecer al usuario (`owner_id = (select auth.uid())`). |
| **`ideas`** | `anon` | `id, activity_id, content, status, created_at, published_at` | `SELECT` | `status = 'published'` y la actividad vinculada se encuentra en `open` o `closed`. |
| **`ideas`** | `authenticated` | Todas las columnas | `SELECT, UPDATE, DELETE` | Subconsulta de titularidad: la actividad vinculada pertenece al usuario autenticado. |
| **`idea_authors`**| `anon` | Ninguna | Ninguna (`REVOKE ALL`) | No accesible públicamente bajo ninguna circunstancia. |
| **`idea_authors`**| `authenticated` | Todas las columnas | `SELECT` | Subconsulta de titularidad: la actividad pertenece a `owner_id = (select auth.uid())`. |

---

### 5. Inserción Transaccional Segura: Función RPC `submit_idea`

La creación de participantes, ideas y enlaces de autoría nunca se realiza mediante escrituras directas de clientes sobre las tablas relacionales. Toda inserción pública se canaliza obligatoriamente a través de la función RPC `public.submit_idea`.

#### 5.1. Evolución del Contrato de la RPC
- **Definición inicial (Migración 2 `20261002120000_submit_idea_rpc.sql`):**
  - Firma: `submit_idea(activity_code, participant_first_name, participant_last_name, participant_email, idea_content)`.
  - Retorno original: `TABLE(idea_id uuid, idea_status public.idea_status)`.
  - Comportamiento: Inserción atómica de participante con `ON CONFLICT (activity_id, email) DO UPDATE`, inserción de idea y vinculación en `idea_authors`.
- **Sustitución vigente en repositorio (Migración 4 `20261012160000_submit_idea_rate_limit_and_dedupe.sql`):**
  - La función anterior fue descartada (`DROP FUNCTION`) y recreada con un contrato ampliado para resolver deduplicación de contenido y límites de tasa.
  - **Firma vigente:**
    ```sql
    public.submit_idea(
      activity_code text,
      participant_first_name text,
      participant_last_name text,
      participant_email text,
      idea_content text
    )
    RETURNS TABLE (
      outcome text,
      idea_id uuid,
      idea_status public.idea_status
    )
    ```

#### 5.2. Mecanismos de Control de la RPC Vigente
1. **Validaciones de entrada:** Comprobación estricta de longitudes (nombre 1-100, apellido 1-100, email 3-254 con `'@'`, contenido 1-500). Eleva error `22023` si los datos son inválidos.
2. **Localización de actividad:** Búsqueda por `public_code` en mayúsculas (`FOR SHARE`). Eleva `P0002` si la actividad no existe.
3. **Upsert de participante:** Inserta o actualiza el nombre/apellido en caso de coincidir el email normalizado dentro de la actividad.
4. **Serialización transaccional mediante Advisory Lock:**
   ```sql
   PERFORM pg_advisory_xact_lock(
     hashtextextended(target_activity_id::text || ':' || target_participant_id::text, 0)
   );
   ```
   Garantiza que envíos concurrentes del mismo participante dentro de la misma actividad se serialicen bajo nivel de aislamiento `READ COMMITTED`, evitando condiciones de carrera en las comprobaciones posteriores.
5. **Deduplicación permanente de contenido:** Normaliza el texto eliminando espacios redundantes y convirtiendo a minúsculas (`lower(btrim(regexp_replace(idea_content, '\s+', ' ', 'g')))`). Si el participante ya envió esa misma idea en la actividad:
   - Retorna: `outcome = 'duplicate'`, `idea_id = null`, `idea_status = null`. No inserta ninguna fila ni consume cuota.
6. **Límite de tasa por ventana móvil (Rate Limiting):** Cuenta las ideas enviadas por el participante en la actividad en los últimos 60 segundos (`window_seconds constant integer := 60`). Si el conteo es $\ge 5$ (`max_ideas_per_window constant integer := 5`):
   - Retorna: `outcome = 'rate_limited'`, `idea_id = null`, `idea_status = null`. No inserta fila.
7. **Inserción exitosa:** Inserta en `public.ideas` (donde el trigger asigna estado según el modo del muro) y en `public.idea_authors`.
   - Retorna: `outcome = 'accepted'`, `idea_id = <UUID>`, `idea_status = <status>`.
8. **Seguridad:** Declarada `SECURITY DEFINER` con `SET search_path = ''`. Privilegios revocados de `public`, otorgados a `anon` y `authenticated`.

---

## PARTE II: Extensiones de Administración Global, Auditoría y Exportación (Propuestas Técnicas de Fase 2 — Migraciones 5 a 9)

> [!NOTE]
> Esta sección describe las estructuras relacionales, políticas e índices introducidos por las migraciones 5 a 9. Conforme a las notas explícitas de sus encabezados, estas piezas fueron preparadas como **propuestas técnicas para revisión estática e independiente**, orientadas a soportar el rol de administración transversal, la trazabilidad transaccional inmutable y la exportación de resultados. Su aplicación efectiva en la base de datos de producción permanece sin verificar.

### 6. Administración Global y Autorización Transversal

#### 6.1. Tipo `public.app_role` y Tabla `public.user_roles` (Migración 5)
Permite asignar roles privilegiados a usuarios de Supabase Auth sin depender de claims estáticos de JWT ni metadatos manipulables en cliente.
- **Tipo enumerado:** `create type public.app_role as enum ('admin_global');`.
- **Tabla `public.user_roles`:**
  - `user_id`: UUID clave primaria, referencia a `auth.users(id)` con `ON DELETE CASCADE`.
  - `role`: Valor del enum `public.app_role` (`'admin_global'`).
  - `created_at`: Marca temporal de concesión del rol.
- **Blindaje RLS:** Habilitado con `REVOKE ALL ON TABLE public.user_roles FROM public, anon, authenticated;`. Ningún cliente PostgREST puede leer ni modificar directamente la tabla.

#### 6.2. Función SQL Autorizadora `public.is_admin()` (Migración 5)
```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (SELECT auth.uid()) AND role = 'admin_global'
  );
$$;
```
Permite evaluar privilegios administrativos dentro de políticas RLS y Server Actions de forma centralizada y resistente a inyecciones. Ejecución concedida a `authenticated`.

#### 6.3. Inmutabilidad Estricta de Titularidad: `activities.owner_id` (Migración 5)
Para prevenir la apropiación indebida o transferencia accidental de actividades, la Migración 5 incorpora una función y disparador que prohíbe cualquier mutación sobre la columna `owner_id`:
```sql
CREATE OR REPLACE FUNCTION public.prevent_activity_owner_change()
RETURNS trigger AS $$
BEGIN
  IF new.owner_id IS DISTINCT FROM old.owner_id THEN
    RAISE EXCEPTION 'El campo owner_id es inmutable y no puede modificarse'
      USING errcode = 'check_violation';
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SET search_path = '';

CREATE TRIGGER activities_prevent_owner_change
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.prevent_activity_owner_change();
```

#### 6.4. Políticas RLS Aditivas para Administradores Globales (Migraciones 5 y 6)
Operan bajo lógica disyuntiva (`OR`) combinadas con las políticas de propietario del MVP:
- `activities`: Los administradores pueden consultar (`SELECT`), actualizar (`UPDATE`) y borrar (`DELETE`) todas las actividades si `public.is_admin() = true`.
- `ideas`: Los administradores pueden consultar, moderar estado y eliminar todas las ideas.
- `participants` e `idea_authors`: Los administradores pueden consultar participantes y enlaces de autoría de cualquier actividad.
- `audit_logs`: Los administradores pueden consultar la bitácora mediante la política `"Admins can read audit logs"` (Migración 6).

---

### 7. Auditoría Transaccional e Integridad de Cascada (C5 / Payload v2)

Las migraciones 5, 7 y 8 estructuran un subsistema de bitácora transaccional inmutable (`audit_logs`) diseñado para auditar mutaciones críticas con preservación de identidad y discriminación precisa de borrados en cascada.

#### 7.1. Tabla `public.audit_logs` (Migración 5)
- **Columnas:**
  - `id`: UUID identificador (`gen_random_uuid()`).
  - `actor_id`: UUID del usuario que ejecuta la acción, referencia a `auth.users(id)` con `ON DELETE SET NULL`.
  - `actor_type`: Tipo de actor (`'authenticated_user'` o `'system_or_internal'`).
  - `action`: Código de la acción auditada (`varchar(50)`).
  - `target_table`: Tabla afectada (`'activities'`, `'ideas'`, `'user_roles'`).
  - `target_id`: UUID de la fila intervenida.
  - `payload`: Snapshot `jsonb` con los valores previos, posteriores o metadatos relevantes.
  - `created_at`: Marca de tiempo de registro (`now()`).
- **Preservación de identidad forense:** Los disparadores capturan `(select auth.uid())` y lo replican dentro del campo `payload->>'actor_id_snapshot'`. Si el usuario es purgado de `auth.users`, la clave foránea `actor_id` pasa a `NULL` (`ON DELETE SET NULL`), pero la referencia histórica en el JSON permanece intacta sin violar restricciones referenciales.
- **Índices de auditoría:**
  - `audit_logs_target_idx` sobre `(target_table, target_id)`.
  - `audit_logs_created_at_idx` sobre `(created_at desc)`.
  - `audit_logs_actor_idx` sobre `(actor_id)`.
  - `audit_logs_created_at_id_idx` sobre `(created_at desc, id desc)` (Migración 7, diseñado para ordenación determinista en paginación ante ticks de reloj idénticos).

#### 7.2. Tabla de Contexto Transaccional Efímero: `audit_cascade_context` (Migraciones 7 y 8)
Diseñada para resolver el problema de amplificación de eventos durante la eliminación de una actividad padre con decenas de ideas y participantes asociados:
- **Estructura (ampliada en Migración 8):**
  - `activity_id`: UUID de la actividad en proceso de borrado.
  - `tx_id`: Identificador de la transacción PostgreSQL (`txid_current()`).
  - Clave primaria compuesta sobre `(activity_id, tx_id)`.
  - Contadores: `ideas_count`, `participants_count`, `idea_authors_count`.
- **Mecanismo de captura independiente del orden (Migración 8):**
  - En lugar de contadores incrementales dependientes del orden de disparadores hijos (descartados por inconsistencias empíricas entre niveles de cascada de Postgres), la función `fn_audit_activity_before_delete()` (`BEFORE DELETE ON activities`) ejecuta un `SELECT count(*)` exacto sobre `ideas`, `participants` e `idea_authors` en el único instante en que el padre y todos los descendientes coexisten en la transacción.
  - La función `fn_audit_idea_delete()` consulta la existencia del contexto para suprimir eventos individuales de borrado de ideas cuando la actividad está siendo eliminada en cascada.
  - La función `fn_audit_activity_after_delete()` emite un único evento consolidado `'activity_delete_cascade'` con el contrato **Payload v2**:
    ```json
    {
      "title": "...",
      "status": "...",
      "owner_id": "...",
      "public_code": "...",
      "contract_version": 2,
      "ideas_deleted_count": 14,
      "participants_deleted_count": 8,
      "idea_authors_deleted_count": 14
    }
    ```
    Y purga la fila de contexto de forma atómica.

#### 7.3. Catálogo de Acciones Auditadas por Disparadores
1. `activity_status_change`: Modificación de `status` en actividades (`fn_audit_activity_update`).
2. `activity_updated`: Modificación de campos descriptivos (`title`, `question`, `moderation_mode`).
3. `activity_delete`: Borrado de actividad sin entidades subordinadas.
4. `activity_delete_cascade`: Borrado de actividad con entidades subordinadas (payload v2).
5. `idea_created`: Creación de una nueva idea (audita longitud de texto sin registrar el contenido textual, protegiendo privacidad).
6. `idea_moderate_status`: Moderación de estado de una idea (`pending` $\to$ `published` / `hidden`).
7. `idea_delete_individual`: Eliminación manual individual de una idea por parte del organizador o administrador.
8. `admin_role_granted`: Asignación de rol `admin_global` a un usuario (`fn_audit_user_roles_mutation`).
9. `admin_role_revoked`: Revocación del rol `admin_global`.

---

### 8. Exportación Consistente de Resultados: Función RPC `export_activity_ideas` (Migración 9)

Implementa la extracción atómica de ideas para la generación de reportes y descargas en formatos CSV o HTML estructurado, garantizando aislamiento transaccional y protección contra sobrecargas.

- **Firma:** `public.export_activity_ideas(target_activity_id uuid, export_scope text default 'published') RETURNS jsonb`.
- **Seguridad:** `SECURITY DEFINER`, `SET search_path = public, pg_temp`. Ejecutable exclusivamente por usuarios `authenticated`.
- **Aislamiento MVCC en sentencia única:** Ejecuta la validación de titularidad (`owner_id = auth.uid()`) y la lectura de ideas en una sola consulta con Common Table Expressions (`WITH target_act AS (...), candidate_ideas AS (...)`). Esto asegura que la exportación represente un snapshot coherente (*point-in-time*) sin condiciones de carrera.
- **Parámetros de alcance (`export_scope`):**
  - `'published'`: Exporta únicamente las ideas aprobadas y presentadas en el muro.
  - `'all'`: Exporta todas las ideas de la actividad (incluyendo pendientes y ocultas), reservado para el organizador de la actividad.
- **Protección contra desbordamiento:** Límite máximo establecido en 5.000 ideas (`v_limit constant integer := 5000`). Si el conteo supera el umbral, aborta la serialización y retorna `{ "error": "payload_too_large", "total": <count>, "limit": 5000 }` para prevenir saturación de memoria en la base de datos o en el servidor Next.js.
- **Retorno estructurado:** Retorna un objeto JSON con los metadatos de la actividad y la colección ordenada cronológicamente de ideas (`id`, `content`, `status`, `created_at`, `published_at`), omitiendo cualquier dato de autoría o identidad personal.

---

## PARTE III: Trazabilidad Integral de Migraciones SQL

La siguiente tabla consolida la cronología, identificadores, propósitos y relaciones de las 9 migraciones versionadas en el repositorio oficial:

| # | Archivo de Migración | Ámbito | Propósito Principal y Cambios en el Catálogo | Estado Documental |
| :-: | :--- | :--- | :--- | :--- |
| **1** | `20261002080804_initial_data_model.sql` | **Núcleo MVP** | Creación de enums (`activity_status`, `moderation_mode`, `idea_status`), tablas `activities`, `participants`, `ideas`, `idea_authors`, claves foráneas compuestas, triggers iniciales de ideas y habilitación de Realtime. | Baseline consolidado del MVP |
| **2** | `20261002120000_submit_idea_rpc.sql` | **Núcleo MVP** | Creación de la primera versión de la RPC `submit_idea` (retorno básico `idea_id, idea_status`). | **Superada** por Migración 4 |
| **3** | `20261012142000_restrict_activities_read_to_anon.sql` | **Núcleo MVP** | Restricción de la política de lectura pública de actividades exclusivamente al rol PostgREST `anon` (resolución R1 / H-01). | Regla activa del MVP |
| **4** | `20261012160000_submit_idea_rate_limit_and_dedupe.sql` | **Núcleo MVP** | Sustitución completa de `submit_idea`: añade advisory lock transaccional, deduplicación de contenido permanente y límite de 5 envíos en 60 s (`outcome`: accepted/duplicate/rate_limited). | Contrato vigente de la RPC |
| **5** | `20261018040000_admin_global_authorization.sql` | **Fase 2** | Creación de enum `app_role`, tabla `user_roles`, función `is_admin()`, trigger de inmutabilidad de `owner_id`, tabla `audit_logs`, políticas RLS de admin y triggers iniciales de auditoría. | Propuesta técnica para revisión |
| **6** | `20261018083000_audit_logs_admin_read_policy.sql` | **Fase 2** | Política RLS que permite a usuarios con `is_admin() = true` consultar la bitácora `audit_logs`. | Propuesta técnica para revisión |
| **7** | `20261020130000_administrative_audit_hardening.sql` | **Fase 2** | Creación de tabla efímera `audit_cascade_context` (C5), implementación de 7 disparadores refinados de auditoría en activities, ideas y roles, e índice compuesto determinista. | Propuesta técnica para revisión |
| **8** | `20261021140000_audit_cascade_counts_v2.sql` | **Fase 2** | Mecanismo de conteo independiente del orden en el `BEFORE DELETE` del padre y especificación del Payload v2 para `activity_delete_cascade` (conteo exacto de ideas, participantes y autores). | Propuesta técnica para revisión |
| **9** | `20261029170000_export_activity_ideas_rpc.sql` | **Fase 2** | Creación de la función RPC `export_activity_ideas` con snapshot transaccional MVCC, límite defensivo de 5.000 ideas y exclusión de datos personales. | Propuesta técnica para revisión |

---

## 9. Pantallas y Consumo en la Aplicación

- `/a/[code]`: Formulario de participación ciudadana / móvil. Invoca a través de Server Action la RPC `public.submit_idea`.
- `/muro/[code]`: Pantalla de proyección pública con código QR. Se suscribe vía Supabase Realtime a cambios de `public.ideas` filtrando en cliente por `activity_id`.
- `/panel`: Interfaz de gestión para el organizador autenticado. Permite crear actividades y consultar historial de eventos propios.
- `/panel/actividad/[id]`: Consola de control de la actividad. Permite cambiar el `moderation_mode`, abrir/cerrar la actividad, moderar ideas en tiempo real, visualizar lista de participantes y exportar resultados (CSV/HTML).
- `/admin` (Propuesta de Fase 2 en ramas de integración): Panel de administración global que evalúa `public.is_admin()` para supervisión transversal de actividades y consulta de auditoría.