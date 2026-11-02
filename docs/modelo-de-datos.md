# Modelo de datos relacional y seguridad en base de datos

El esquema relacional de la aplicación se gestiona mediante migraciones SQL versionadas en el directorio `supabase/migrations/`.

---

## 1. Diagrama Entidad-Relación (ERD)

```mermaid
erDiagram
    AUTH_USERS ||--o{ ACTIVITIES : organiza
    AUTH_USERS ||--o| ADMIN_GLOBAL : rol_global
    AUTH_USERS ||--o{ AUDIT_LOGS : audita
    ACTIVITIES ||--o{ PARTICIPANTS : registra
    ACTIVITIES ||--o{ IDEAS : recibe
    IDEAS ||--|| IDEA_AUTHORS : atribuye
    PARTICIPANTS ||--o{ IDEA_AUTHORS : escribe

    AUTH_USERS {
        uuid id PK
    }
    ADMIN_GLOBAL {
        uuid user_id PK_FK
        timestamptz created_at
        uuid created_by FK
    }
    ACTIVITIES {
        uuid id PK
        uuid owner_id FK
        string public_code UK
        string title
        string question
        activity_status status
        moderation_mode moderation_mode
        integer last_idea_number "Contador atómico"
        timestamptz created_at
        timestamptz opened_at
        timestamptz closed_at
    }
    PARTICIPANTS {
        uuid id PK
        uuid activity_id FK
        string first_name
        string last_name
        string email
        timestamptz created_at
    }
    IDEAS {
        uuid id PK
        uuid activity_id FK
        string content
        idea_status status
        integer idea_number "Correlativo por actividad"
        timestamptz created_at
        timestamptz published_at
    }
    IDEA_AUTHORS {
        uuid activity_id FK
        uuid idea_id PK_FK
        uuid participant_id FK
        timestamptz created_at
    }
    AUDIT_LOGS {
        uuid id PK
        timestamptz created_at
        uuid actor_id FK
        text action
        text target_type
        text target_id
        jsonb details "Payload V2 con conteos de cascada"
    }
```

---

## 2. Descripción de Entidades

### `activities`
Representa una dinámica o taller convocado por un organizador (`owner_id` vinculado a `auth.users`).
- **Campos destacados:**
  - `public_code`: Código alfanumérico único de 8 caracteres utilizado en URLs de participación y proyección.
  - `status`: Enumerado `'draft'`, `'open'` o `'closed'`.
  - `moderation_mode`: Enumerado `'automatic'` (publicación directa) o `'approval'` (revisión obligatoria previa).
  - `last_idea_number`: Entero contador monótono incremental (`DEFAULT 0`), actualizado atómicamente por trigger al insertar ideas para garantizar numeración correlativa sin saltos concurrentes.

### `participants`
Registra a las personas que envían ideas dentro de una actividad específica.
- `email`: Almacenado normalizado en minúsculas. Es único por combinación `(activity_id, email)`.
- No requiere creación de cuenta de usuario ni contraseña.
- Se elimina en cascada al suprimirse la actividad.

### `ideas`
Almacena el contenido textual propuesto (de 1 a 500 caracteres) y su estado de moderación.
- `status`: Enumerado `'pending'`, `'published'` o `'hidden'`.
- `idea_number`: Entero correlativo asignado de forma determinista y atómica por la función trigger `assign_idea_number()`.
- **Restricción de integridad:** `UNIQUE (activity_id, idea_number)` que garantiza que no puedan existir dos ideas con el mismo número dentro de la misma actividad.
- **Privacidad:** La tabla no almacena referencias directas de autor ni datos personales del participante.

### `idea_authors`
Tabla de atribución privada que vincula unívocamente una idea con el participante que la redactó.
- Claves foráneas compuestas con `ON DELETE CASCADE`.
- Solo accesible mediante RLS por el propietario organizador de la actividad o por administradores con privilegios de auditoría.

### `admin_global`
Registro de identidades autorizadas con el rol de superadministrador de plataforma.
- `user_id`: Clave foránea contra `auth.users(id)` con eliminación en cascada.
- No dispone de Server Actions públicas de asignación. Se aprovisiona exclusivamente por procedimiento manual en base de datos.

### `audit_logs`
Bitácora de auditoría administrativa inmutable.
- Registra cada acción de borrado o cambio de estado ejecutada en `/admin`.
- `details`: Almacena metadatos JSONB con versión de contrato (`contract_version = 2`), incluyendo conteos atómicos previos a operaciones en cascada (`activity_count`, `participant_count`, `idea_count`).

---

## 3. Inventario de Migraciones y Estado de Sincronización

| Migración | Propósito y Contrato | Estado Local | Estado Producción |
| :--- | :--- | :---: | :---: |
| `20261002080804_initial_data_model.sql` | Esquema base, RLS inicial y tipos enumerados. | Aplicada | Aplicación documentada en reportes históricos del proyecto; sin consulta remota independiente en la auditoría actual. |
| `20261002120000_submit_idea_rpc.sql` | Función transaccional `submit_idea`. | Aplicada | Aplicación documentada en reportes históricos del proyecto; sin consulta remota independiente en la auditoría actual. |
| `20261012142000_restrict_activities_read_to_anon.sql` | Restricción de columnas de actividad visibles al público. | Aplicada | Aplicación documentada en reportes históricos del proyecto; sin consulta remota independiente en la auditoría actual. |
| `20261012160000_submit_idea_rate_limit_and_dedupe.sql` | Rate limiting de 30s y deduplicación exacta en `submit_idea`. | Aplicada | Aplicación documentada en reportes históricos del proyecto; sin consulta remota independiente en la auditoría actual. |
| `20261018040000_admin_global_authorization.sql` | Creación de `admin_global`, `audit_logs` y funciones de guarda. | Aplicada | Aplicación documentada en reportes históricos del proyecto; sin consulta remota independiente en la auditoría actual. |
| `20261018083000_audit_logs_admin_read_policy.sql` | Política RLS para lectura de bitácora por `admin_global`. | Aplicada | Aplicación documentada en reportes históricos del proyecto; sin consulta remota independiente en la auditoría actual. |
| `20261020130000_administrative_audit_hardening.sql` | Endurecimiento de funciones y bitácora de auditoría V1. | Aplicada | Aplicación documentada en reportes históricos del proyecto; sin consulta remota independiente en la auditoría actual. |
| `20261021140000_audit_cascade_counts_v2.sql` | Auditoría V2 con conteo pre-cascada y `contract_version=2`. | Aplicada | **DESCONOCIDO** |
| `20261028150000_ideas_atomic_numbering.sql` | `last_idea_number`, `idea_number` y trigger atómico. | Aplicada | **DESCONOCIDO** |
| `20261029170000_export_activity_ideas_rpc.sql` | RPC `export_activity_ideas` para exportación en JSONB. | Aplicada | **DESCONOCIDO** |

---

## 4. Observaciones de Precisión Documental y Defectos de Seguridad

### 4.1. Defecto de permisos sobre `idea_number` para rol anónimo (`anon`)
- En la migración fundacional `20261002080804`, la tabla `ideas` recibió un permiso selectivo por columnas:
  ```sql
  GRANT SELECT (id, activity_id, content, status, created_at, published_at)
    ON TABLE public.ideas TO anon;
  ```
- Al introducir la columna `idea_number` en `20261028150000_ideas_atomic_numbering.sql`, **no se ejecutó** la instrucción correspondiente para otorgar acceso a dicho campo:
  ```sql
  -- Instrucción omitida en 20261028150000:
  GRANT SELECT (idea_number) ON TABLE public.ideas TO anon;
  ```
- **Consecuencia técnica:** Las consultas directas ejecutadas desde el navegador por usuarios sin autenticar (muro público) que intenten proyectar `idea_number` resultarán en error de PostgreSQL `permission denied for column idea_number of relation ideas`.
- **Falta en cliente:** En `src/components/live-wall.tsx`, las consultas de descubrimiento y reconciliación (*catch-up*) omiten `idea_number`, causando que las ideas recuperadas tras reconexión carezcan de número asignado en memoria.

### 4.2. Situación de la Migración 10 (`20261029170000`)
- La migración `20261029170000_export_activity_ideas_rpc.sql` se encuentra físicamente aplicada en la base de datos PostgreSQL local.
- **Constancia formal:** La auditoría técnica 14O constató que **no existe registro documental de autorización previa** para la aplicación de esta migración en la base de datos local.
- Se documenta expresamente esta discrepancia de procedimiento sin inferir autorización retroactiva.
- **Regla estricta:** Queda terminantemente prohibido aplicar esta migración en el entorno de producción hasta que se emita la autorización expresa del usuario.

### 4.3. Estado no verificado de producción para migraciones 8, 9 y 10
No existe evidencia documental ni telemetría comprobable de que las migraciones `20261021140000`, `20261028150000` y `20261029170000` hayan sido ejecutadas en la base de datos conectada a producción. Se registran bajo el estado formal de **DESCONOCIDO**.
