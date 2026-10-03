# Modelo de datos del MVP

El esquema inicial vive en `supabase/migrations/20261002080804_initial_data_model.sql`.

## Entidades

```mermaid
erDiagram
    AUTH_USERS ||--o{ ACTIVITIES : organiza
    ACTIVITIES ||--o{ PARTICIPANTS : registra
    ACTIVITIES ||--o{ IDEAS : recibe
    IDEAS ||--|| IDEA_AUTHORS : atribuye
    PARTICIPANTS ||--o{ IDEA_AUTHORS : escribe

    AUTH_USERS {
        uuid id PK
    }
    ACTIVITIES {
        uuid id PK
        uuid owner_id FK
        string public_code UK
        string title
        string question
        activity_status status
        moderation_mode moderation_mode
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
        timestamptz created_at
        timestamptz published_at
    }
    IDEA_AUTHORS {
        uuid activity_id FK
        uuid idea_id PK_FK
        uuid participant_id FK
        timestamptz created_at
    }
```

### `activities`

Pertenece a una cuenta de organizador de Supabase Auth. Tiene un código público aleatorio de ocho caracteres, título, pregunta, estado (`draft`, `open` o `closed`) y modo de publicación (`automatic` o `approval`). La publicación automática es el valor inicial.

### `participants`

Registra nombre, apellido y email dentro de una actividad. El email se guarda normalizado a minúsculas y es único por actividad. No se crea una cuenta de participante ni se verifica su email. Al borrar la actividad se eliminan estos datos.

### `ideas`

Guarda el texto de hasta 500 caracteres y su estado (`pending`, `published` o `hidden`). No contiene nombre, email ni identificador de participante, por lo que el flujo público de Realtime no necesita transportar datos personales.

### `idea_authors`

Vincula cada idea con el participante que la envió. Solo el organizador dueño de la actividad puede leer esta relación. Sus claves foráneas compuestas impiden asociar una idea o participante de otra actividad.

## Reglas de acceso y comportamiento

- Las tablas tienen RLS activado; los permisos SQL y las políticas RLS se definen juntos en la migración.
- Cualquier visitante puede leer campos públicos de actividades abiertas o cerradas, y solo ideas publicadas de esas actividades.
- El organizador puede consultar y administrar sus actividades, ver los datos de sus participantes, moderar y eliminar ideas.
- El organizador puede eliminar una actividad propia. Las claves foráneas con `ON DELETE CASCADE` eliminan también las ideas, los participantes y los vínculos de autoría; la app no tiene recuperación para esta operación.
- Las escrituras de participantes, ideas y autoría pasan por la función `submit_idea`, invocada desde una Server Action. La función registra los datos de forma atómica y devuelve solo el estado e ID de la idea; no expone la clave `service_role`.
- Una idea solo se puede insertar mientras la actividad está abierta. La base de datos aplica el modo vigente: `published` en automático y `pending` con aprobación.
- Cambiar el modo afecta las ideas nuevas. Las ideas que ya estaban pendientes siguen pendientes hasta que el organizador las revise.
- Al cerrar una actividad, las ideas publicadas siguen disponibles para la pantalla pública y ya no se admiten envíos.
- No hay tabla de votos en esta etapa; se incorpora cuando se implemente la segunda fase.

## Migración y pantallas

- `20261002120000_submit_idea_rpc.sql` agrega la función que recibe el código público, los datos del participante y el texto de la idea.
- `/panel` permite crear actividades y revisar el historial. `/panel/actividad/[id]` muestra participantes solo al organizador y permite moderar ideas, cambiar el modo de publicación, cerrar o reabrir la actividad y eliminarla.
- `/a/[code]` es el formulario móvil para participar. `/muro/[code]` es la pantalla pública con QR y actualización en tiempo real.
- Los organizadores usan `/crear-cuenta` y `/ingresar`. `/recuperar-contrasena`, `/auth/callback` y `/restablecer-contrasena` implementan el flujo de recuperación de contraseña de Supabase Auth.

El alcance del MVP y sus límites de seguridad y despliegue están descritos en [arquitectura.md](arquitectura.md) y [despliegue.md](despliegue.md).
