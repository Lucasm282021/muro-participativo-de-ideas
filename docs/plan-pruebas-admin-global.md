# Protocolo de Pruebas Aisladas para Rol `admin_global`

**Proyecto:** Muro Participativo de Ideas  
**Rama:** `feat/pagina-administracion-from-dev`  
**Commit base / HEAD:** `0a12e2a95d8f6234070d2480f2f3817f6b51143c`  
**Estado:** Documento de diseño de pruebas (solo lectura). No ejecutado.  
**Documento de referencia:** `docs/plan-admin-global.md`

---

## 1. Alcance y límites de la fase

Este documento define el procedimiento técnico y metodológico para someter a prueba el modelo de autorización, políticas RLS, Server Actions y vistas administrativas asociadas al rol `admin_global`, antes de su implementación definitiva y despliegue.

### Límites estrictos de la fase actual:
1. **Fase puramente documental:** La presente autorización abarca exclusivamente la definición, corrección y ajuste del protocolo de pruebas. No habilita la ejecución de migraciones, mutaciones en base de datos ni modificaciones de código funcional.
2. **Entornos alcanzados:** Las pruebas contempladas en este protocolo están concebidas exclusivamente para ejecutarse en entornos desechables y aislados (instancia de Supabase CLI local o proyecto en la nube dedicado y vacío para pruebas).
3. **Entornos prohibidos y fuera de alcance:** Producción (`Main`), staging y la rama base de integración (`Dev`) están formalmente excluidos de cualquier prueba interactiva o de escritura.
4. **Independencia funcional:** La ejecución futura de este plan no debe alterar el flujo estándar de organizadores ni las capacidades actuales de los participantes anónimos (`anon`).

---

## 2. Metodología de ejecución por fases estrictas y verificación de aislamiento

Para garantizar un entorno higiénico, reproducible y exento de contaminación cruzada hacia proyectos remotos o ramas protegidas, la futura ejecución de pruebas se estructura en **cinco fases metodológicas independientes**.

> [!IMPORTANT]
> **Advertencia sobre vínculo remoto:** En `supabase/.temp/` existe un registro de enlace previo hacia un proyecto en la nube. Esta presencia **exige precauciones estrictas** (prohibición terminante de `supabase db push`, `db remote *` y cualquier uso de banderas `--linked`), pero **no demuestra por sí sola que una conexión local se dirija a producción**. La certeza del aislamiento se demuestra empíricamente verificando los endpoints locales (`http://127.0.0.1:25435` y PostgreSQL puerto `25433`). No se debe renombrar o alterar archivos de `.temp` como pretendida garantía de aislamiento.

---

### Fase A: Comprobaciones estáticas y de solo lectura (Sin efectos colaterales)
- **Efecto:** Cero modificaciones en base de datos, código o configuración.
- **Precondiciones:** Repositorio en rama `feat/pagina-administracion-from-dev`, commit `0a12e2a95d8f6234070d2480f2f3817f6b51143c`.
- **Acciones:**
  1. Verificar estado de Git: `git status --short`.
  2. Comprobación estática de tipos: `npx tsc --noEmit`.
  3. Verificación de configuración en `supabase/config.toml`: API port `25435`, DB port `25433`, Studio port `25434`.
  4. Inspección de `.env.local`: asegurar que `NEXT_PUBLIC_SUPABASE_URL` apunte a `http://127.0.0.1:25435`.
- **Criterio de parada:** Cualquier discrepancia de rama, error de compilación o valor de conexión ambiguo aborta el procedimiento.

---

### Fase B: Inicio de servicios y verificación de aislamiento local
- **Efecto:** Puesta en marcha de contenedores locales de Supabase.
- **Precondiciones:** Docker Desktop en ejecución. Prohibido utilizar `--linked` o parámetros remotos.
- **Acciones:**
  1. Iniciar el entorno local: `npx supabase start` (utiliza puertos configurados en `supabase/config.toml`).
  2. Comprobar estado de puertos efectivos: `npx supabase status`.
     - API URL: `http://127.0.0.1:25435`
     - DB URL: `postgresql://postgres:postgres@127.0.0.1:25433/postgres`
     - Studio URL: `http://127.0.0.1:25434`
  3. **Demostración fehaciente de aislamiento en PostgreSQL:**
     Conectarse mediante cliente SQL local a `127.0.0.1:25433` y ejecutar:
     ```sql
     SELECT inet_server_addr(), inet_server_port();
     SHOW config_file;
     ```
     - `inet_server_port()` debe ser exactamente `25433`.
     - `config_file` debe retornar la ruta interna de Docker (`/etc/postgresql/...`), certificando que no se interactúa con AWS ni con Supabase Cloud.
- **Criterio de parada:** Si el puerto efectivo no es `25433` o la API no responde en `127.0.0.1:25435`, detener de inmediato sin continuar.

---

### Fase C: Aplicación de migraciones y creación de datos sintéticos
- **Efecto:** Mutación del esquema relacional y registro de usuarios de prueba.
- **Precondiciones indispensables:**
  - **Autorización explícita e independiente:** La aplicación de la migración `20261018040000_admin_global_authorization.sql` modifica el esquema y exige aprobación expresa previa.
  - **Prohibición de `supabase db reset`:** `supabase db reset` permanece terminantemente **prohibido** hasta que el operador confirme por escrito que la base de datos local y sus volúmenes son 100% descartables.
- **Acciones:**
  1. Aplicar migración de forma estrictamente local: `npx supabase migration up --local` (o `supabase db reset` solo con confirmación previa expresa).
  2. Crear los usuarios sintéticos en `auth.users` (detallados en §3).
  3. Asignar el rol administrativo inicial:
     ```sql
     INSERT INTO public.user_roles (user_id, role)
     VALUES ('<UUID_USUARIO_A>', 'admin_global');
     ```
  4. Poblar las actividades e ideas sintéticas de prueba.
- **Criterio de parada:** Falla en la aplicación del DDL, violación de constraints o inconsistencia en la asignación del rol.

---

### Fase D: Pruebas de autorización en aplicación y pruebas SQL complementarias
- **Efecto:** Evaluación de flujos de autenticación, autorización y auditoría.
- **Precondiciones:** Fase C aprobada; servidor de desarrollo Next.js en ejecución apuntando a `http://127.0.0.1:25435`.
- **Eje 1 — Pruebas en Aplicación mediante sesiones reales de Next.js (Obligatorias):**
  - Autenticar mediante flujo real en `/ingresar` como Usuario B (Organizador): verificar redirección defensiva fuera de `/admin` y rechazo en Server Actions con `{ error: "Acceso denegado: se requieren permisos de administración global." }`.
  - Autenticar como Usuario A (Admin): acceder a `/admin`, verificar renderizado de métricas y actividades ajenas, moderar una idea y cerrar una actividad ajena.
  - **Revocación en caliente:** Eliminar el rol de Usuario A en `public.user_roles` con la sesión abierta en el navegador -> invocar inmediatamente una Server Action administrativa -> verificar rechazo inmediato en el servidor (*fail-closed*) sin que se ejecute ninguna mutación en la base de datos.
- **Eje 2 — Pruebas SQL complementarias a bajo nivel (No sustituyen a la app):**
  - Validación de RLS y privilegios relacionales (Matriz §8.2).
  - Inmutabilidad de `owner_id` (rechazo mediante `check_violation`).
  - **Persistencia de `actor_id_snapshot` ante eliminación de cuenta:**
    1. Usuario A genera mutación auditada.
    2. Se comprueba que `audit_logs` tiene `actor_id = <UUID_A>` y `payload->>'actor_id_snapshot' = '<UUID_A>'`.
    3. Se ejecuta `DELETE FROM auth.users WHERE id = '<UUID_A>';`.
    4. Se verifica que en `audit_logs`: `actor_id IS NULL` (por `ON DELETE SET NULL`), pero `payload->>'actor_id_snapshot'` **persiste intacto con el UUID histórico**.
  - **Borrado individual vs Cascada:**
    1. Borrado individual de idea (`DELETE FROM ideas WHERE id = ...`): se registra 1 evento `idea_delete_individual`.
    2. Borrado de actividad en cascada (`DELETE FROM activities WHERE id = ...`): se registra exactamente 1 evento `activity_delete` y **cero** eventos `idea_delete_individual` (gracias a `IF parent_exists THEN...`).
  - **Atomicidad transaccional:** La mutación y el registro en `audit_logs` ocurren en la misma transacción síncrona; si el trigger falla, la mutación completa se revierte.
- **Criterio de parada:** Cualquier acceso administrativo no autorizado permitido, fallo de snapshot o regresión en el flujo de organizadores.

---

### Fase E: Limpieza destructiva controlada
- **Efecto:** Detención de servicios locales.
- **Precondiciones:** Conclusión formal y registro de resultados de la Fase D.
- **Acciones:**
  1. Detener contenedores de Supabase: `npx supabase stop`.
- **Criterio de parada:** Servicios locales detenidos de forma limpia.

---

## 3. Uso exclusivo de cuentas y datos sintéticos

Queda terminantemente prohibido el uso de correos reales, datos de producción o copias de respaldo operativas. Se utilizará un conjunto definido de actores y registros sintéticos generados ad-hoc.

### Cuentas sintéticas de prueba:
| Actor de prueba | Identificador / Email | Rol en `user_roles` | Rol esperado en la app |
| :--- | :--- | :--- | :--- |
| **Usuario A (Admin)** | `admin.test@synthetic.local` | `admin_global` | Administrador Global |
| **Usuario B (Organizador 1)** | `organizer.alpha@synthetic.local` | *(ninguno)* | Organizador (propietario Actividad 1) |
| **Usuario C (Organizador 2)** | `organizer.beta@synthetic.local` | *(ninguno)* | Organizador (propietario Actividad 2) |
| **Usuario D (Anónimo / Anon)** | *(sin sesión / sin token)* | *(ninguno)* | Participante público |

### Entidades sintéticas mínimas a instanciar:
- **Actividad 1 (Propietario B):** Modo moderación `approval`, estado `open`. Contiene 3 ideas (`pending`, `published`, `hidden`), 2 participantes y 2 vínculos en `idea_authors`.
- **Actividad 2 (Propietario C):** Modo moderación `automatic`, estado `open`. Contiene 2 ideas (`published`), 1 participante y 1 vínculo en `idea_authors`.
- **Actividad 3 (Propietario C):** Estado `closed`, para validar reaperturas globales.

---

## 4. Establecimiento y verificación de identidad en pruebas SQL directas

En PostgreSQL/Supabase, las políticas RLS dependen de las funciones de contexto `auth.uid()`, `auth.role()` y `auth.jwt()`. Al ejecutar pruebas directamente mediante un cliente SQL (`psql`), la sesión no posee una cabecera HTTP Bearer automática, por lo que **la identidad debe descomponerse y verificarse rigurosamente en sus tres dimensiones formales e independientes**:

1. **Dimensión 1 — Rol de conexión PostgreSQL (`current_user` / `session_user`):** Asignado mediante `SET LOCAL ROLE authenticated` o `SET LOCAL ROLE anon`. Determina los privilegios relacionales básicos (grants de tabla, columna y funciones) concedidos por el motor PostgreSQL.
2. **Dimensión 2 — Contexto JWT de la sesión (`request.jwt.claims`):** Inyección de la variable de configuración de sesión que emula el payload del token JWT decodificado por PostgREST y alimenta a las funciones del esquema `auth` (`auth.jwt()`, `auth.role()`).
3. **Dimensión 3 — Actor sintético específico (`sub` / UUID):** El identificador del usuario sintético específico bajo evaluación (Usuario A `admin_global`, Usuario B `organizador 1`, Usuario C `organizador 2`), devuelto por `auth.uid()`, o nulo (`NULL`) en el caso del Usuario D (`anon`).

### 4.1. Configuración del contexto de identidad por actor

#### Para Usuario Autenticado (Usuario A, B o C):
Toda prueba SQL individual debe ejecutarse dentro de un bloque transaccional controlado que establezca y compruebe las tres dimensiones:
```sql
BEGIN;

-- 1. Dimensión 1: Rol de conexión PostgreSQL
SET LOCAL ROLE authenticated;

-- 2. Dimensión 2 y 3: Contexto JWT y Actor Sintético
SET LOCAL "request.jwt.claims" = json_build_object(
  'sub', '<UUID_DEL_ACTOR>',
  'role', 'authenticated',
  'email', '<EMAIL_DEL_ACTOR>'
)::text;

-- 3. Verificación obligatoria de precondición (GUARD DE TRES DIMENSIONES)
DO $$
BEGIN
  -- Verificación Dimensión 1: Rol PostgreSQL
  IF current_user IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Fallo de rol PostgreSQL (Dimensión 1): current_user es %, se esperaba authenticated', current_user;
  END IF;

  -- Verificación Dimensión 2: Contexto JWT vía auth.jwt()
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Fallo de contexto JWT (Dimensión 2): claim role es inválido o no existe';
  END IF;

  -- Verificación Dimensión 3: Actor Sintético vía auth.uid()
  IF auth.uid() IS DISTINCT FROM '<UUID_DEL_ACTOR>'::uuid THEN
    RAISE EXCEPTION 'Fallo de actor sintético (Dimensión 3): auth.uid() es %, se esperaba %',
      auth.uid(), '<UUID_DEL_ACTOR>';
  END IF;
END $$;

-- 4. Ejecutar las consultas de la prueba aquí...

ROLLBACK; -- Asegura idempotencia en pruebas de mutación o lectura
```

#### Para Usuario Anónimo (Usuario D / Anon):
```sql
BEGIN;

-- 1. Dimensión 1: Rol de conexión PostgreSQL
SET LOCAL ROLE anon;

-- 2. Dimensión 2: Contexto JWT para anónimo
SET LOCAL "request.jwt.claims" = json_build_object(
  'role', 'anon'
)::text;

-- 3. Verificación obligatoria de precondición anónima
DO $$
BEGIN
  -- Verificación Dimensión 1: Rol PostgreSQL
  IF current_user IS DISTINCT FROM 'anon' THEN
    RAISE EXCEPTION 'Fallo de rol anon (Dimensión 1): current_user es %, se esperaba anon', current_user;
  END IF;

  -- Verificación Dimensión 2: Contexto JWT
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'anon' THEN
    RAISE EXCEPTION 'Fallo de contexto JWT anon (Dimensión 2): claim role es inválido';
  END IF;

  -- Verificación Dimensión 3: Ausencia de actor sintético
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Fallo de actor anon (Dimensión 3): auth.uid() debe ser NULL pero devolvió %', auth.uid();
  END IF;
END $$;

-- 4. Ejecutar prueba anónima...

ROLLBACK;
```

---

## 5. Verificación de metadatos, propietario, privilegios y configuración de `public.is_admin()`

Antes de evaluar el acceso a nivel de aplicación, se deben comprobar estáticamente los atributos internos de la función en el catálogo de PostgreSQL (`pg_proc`, `pg_class`, `pg_namespace`).

### Puntos de inspección en la base de datos:
1. **Atributos de ejecución:**
   - `security definer`: Comprobar que la función corra con los privilegios del rol que la definió, para poder consultar `public.user_roles` sin exponer grants directos de lectura a `authenticated`.
   - `stable`: Validar que la volatilidad esté fijada en `STABLE` para permitir optimizaciones de consulta dentro de una misma transacción.
   - `search_path`: Confirmar que esté explícitamente configurado como vacío (`set search_path = ''`), mitigando cualquier riesgo de secuestro de esquemas (schema hijacking), y exigiendo cualificación completa `public.user_roles`.
2. **Propiedad (Ownership) y Bypass de RLS:**
   - El propietario de la función `public.is_admin()` debe coincidir con el propietario de la tabla `public.user_roles` (habitualmente el rol de migraciones `postgres`).
   - Comprobar que `public.user_roles` tenga RLS habilitado (`relrowsecurity = true`), pero que **NO** tenga forzado el RLS para el propietario (`relforcerowsecurity = false`). Esto garantiza que el `security definer` lea la tabla sin quedar bloqueado por la falta de políticas de lectura para usuarios estándar.
3. **Restricción de privilegios de ejecución:**
   - `REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;`
   - `REVOKE ALL ON FUNCTION public.is_admin() FROM anon;`
   - `GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;`
   - Confirmar en `information_schema.routine_privileges` que ningún rol no autenticado posea permisos de invocación.

---

## 6. Mecanismo de inmutabilidad de `activities.owner_id`: Decisión arquitectónica pendiente

La inmutabilidad de `owner_id` es indispensable para evitar que un organizador o un `admin_global` transfiera la titularidad de una actividad ajena. **La elección definitiva del mecanismo se mantiene estrictamente como una decisión pendiente de resolución técnica**, sin implementarse en esta fase.

### 6.1. Revisión técnica de grants existentes y precedentes en el esquema actual:

1. **Revisión del grant de tabla existente:**
   En el esquema vigente hasta el commit `0a12e2a` ([20261002080804_initial_data_model.sql:97](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/supabase/migrations/20261002080804_initial_data_model.sql#L97)), el rol `authenticated` cuenta con un grant completo a nivel de tabla:
   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activities TO authenticated;
   ```
   En PostgreSQL, los privilegios de acceso son **aditivos**: un grant a nivel de tabla anula y hace inoperante cualquier restricción granular de columnas. Por lo tanto, si se deseara restringir la actualización de columnas, es un requisito previo indispensable **revocar explícitamente el grant general de `UPDATE` a nivel de tabla** antes de conceder privilegios sobre columnas individuales.

2. **Revisión del patrón de trigger existente (`published_at`):**
   En el esquema actual existe el trigger `ideas_update_published_at` ([20261002080804_initial_data_model.sql:296](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/supabase/migrations/20261002080804_initial_data_model.sql#L296)), el cual muta automáticamente la marca temporal `new.published_at` cada vez que el organizador o moderador actualiza el campo `status` de una idea.  
   Si en `activities` se llegara a adoptar la estrategia de grants por columna, debe tenerse en cuenta que cualquier trigger automático que modifique columnas temporales (como `closed_at` u `opened_at`) requerirá que dichas columnas estén expresamente concedidas a `authenticated` o que la función trigger se ejecute con `SECURITY DEFINER`, para evitar que la operación falle por falta de privilegios de columna.

### 6.2. Comparativa de opciones arquitectónicas bajo evaluación:

#### Opción 1: Grants por columna en PostgreSQL
- **Mecanismo:** Revocar el grant general y conceder `UPDATE` únicamente sobre columnas no sensibles:
  ```sql
  REVOKE UPDATE ON TABLE public.activities FROM authenticated;
  GRANT UPDATE (title, question, status, moderation_mode, closed_at, opened_at)
    ON TABLE public.activities TO authenticated;
  ```
- **Ventaja:** Bloqueo a nivel del compilador de consultas del motor relacional; no requiere triggers adicionales.
- **Riesgos y dependencias:** Requiere modificar la migración de grants base; exige listar exhaustivamente todas las columnas editables actuales y futuras; puede fallar si clientes o triggers intentan mutar columnas implícitas.
- **Resultado esperado ante intento de modificar `owner_id`:** Error SQL `42501: permission denied for column owner_id` | PostgREST `HTTP 403 Forbidden` *(resultado previsto, por verificar empíricamente)*.

#### Opción 2: Trigger defensivo `BEFORE UPDATE` (Inmutabilidad relacional)
- **Mecanismo:** Mantener los grants de tabla actuales intactos y añadir una función trigger defensiva:
  ```sql
  CREATE OR REPLACE FUNCTION public.check_activities_owner_immutable()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF (OLD.owner_id IS DISTINCT FROM NEW.owner_id) THEN
      RAISE EXCEPTION 'owner_id es inmutable y no puede ser modificado'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;
  ```
- **Ventaja:** No requiere reestructurar los grants vigentes ni revocar permisos de tabla; no colisiona con triggers automáticos de marcas temporales (análogos a `ideas_update_published_at`); permite a clientes emitir sentencias `UPDATE` con todos los campos siempre que el valor de `owner_id` no cambie.
- **Riesgos:** Ejecuta lógica en cada sentencia de actualización (sobrecosto despreciable para cargas normales).
- **Resultado esperado ante intento de modificar `owner_id`:** Excepción de validación de integridad (`raise_exception: check_violation`) | PostgREST `HTTP 400 Bad Request` o `HTTP 409 Conflict` *(resultado previsto, por verificar empíricamente)*.

#### Opción 3: Restricción en cláusula `WITH CHECK` de política RLS
- **Mecanismo:** Agregar `WITH CHECK (owner_id = (SELECT a.owner_id FROM public.activities a WHERE a.id = activities.id))` en la política de actualización.
- **Limitación:** Sobrecosto por subconsulta correlacionada en cada fila evaluada; propensa a complejidades de recursión o ambigüedad con alias.

### 6.3. Caso de prueba de inmutabilidad (NEG-IMMUT-01):
- **Actor:** Usuario A (`admin_global`).
- **Consulta / Mutación:** `UPDATE activities SET owner_id = '<user_A_id>' WHERE id = '<actividad_2_id>';`
- **Resultado esperado según mecanismo que se seleccione en el futuro:**
  - Si se implementa Opción 1: SQL `42501 permission denied for column owner_id` | PostgREST `HTTP 403 Forbidden` *(previsto por verificar)*.
  - Si se implementa Opción 2: SQL `raise_exception: owner_id es inmutable` (`check_violation`) | PostgREST `HTTP 400 Bad Request` o `HTTP 409 Conflict` *(previsto por verificar)*.
- **Invariante no negociable:** En ningún escenario el valor de `owner_id` debe mutar en la base de datos.

---

## 7. Pruebas de regresión de operaciones legítimas de organizadores

Las políticas de seguridad aditivas nunca deben debilitar ni romper el flujo regular de los organizadores sobre sus propios recursos.

### Casos de regresión obligatorios:
1. **REG-ORG-01 (Creación de actividad):**
   - El Usuario B crea una nueva actividad. Debe asignarse automáticamente `owner_id = user_B.id` y completarse con éxito.
2. **REG-ORG-02 (Lectura aislada de actividades):**
   - El Usuario B consulta `SELECT * FROM activities`. Debe recibir únicamente las actividades donde `owner_id = user_B.id`. Las actividades del Usuario C no deben ser devueltas (0 filas ajenas).
3. **REG-ORG-03 (Moderación propia):**
   - El Usuario B cambia el estado de una idea en su Actividad 1 de `pending` a `published`. La operación actualiza exactamente 1 fila y activa correctamente el trigger `ideas_update_published_at`.
4. **REG-ORG-04 (Cierre y eliminación propia):**
   - El Usuario B puede cerrar su Actividad 1 y posteriormente eliminarla, activando la eliminación en cascada sin bloqueos.
5. **REG-ORG-05 (Aislamiento entre organizadores):**
   - El Usuario B intenta consultar o modificar ideas o actividades del Usuario C. RLS filtra la operación retornando 0 filas devueltas o 0 filas afectadas, manteniéndose el aislamiento entre inquilinos.

---

## 8. Casos de prueba §B5: Separación explícita SQL vs PostgREST vs App

Se separan de forma diferenciada e inequívoca las respuestas de bajo nivel en el motor relacional frente a las respuestas HTTP de la capa de API PostgREST y la aplicación Next.js.

### 8.1. Arquitectura de defensa en profundidad: Delimitación de las tres capas de seguridad

Las pruebas deben evaluar de forma diferenciada las tres capas de protección del sistema, bajo el principio rector de que **ninguna capa opera ni debe presentarse como sustituto de las otras**, sino como anillos concéntricos e independientes de defensa en profundidad:

1. **Capa 1 — Privilegios relacionales SQL (`GRANT` / `REVOKE`):**
   - Gobierna el acceso a nivel de objeto del catálogo de PostgreSQL (tablas completas, vistas, columnas y funciones).
   - Opera como compuerta binaria de acceso: si un rol carece del grant correspondiente sobre una tabla, columna o función, el error SQL `42501` (`insufficient_privilege`) es el resultado esperado por falta de privilegios, rechazando el motor PostgreSQL el acceso al recurso.
   - No filtra filas individuales ni conoce la lógica de negocio; define qué operaciones atómicas están habilitadas para el rol de base de datos (`authenticated` o `anon`).
   - *Ejemplo en el modelo:* La falta de `GRANT SELECT` en `public.user_roles` impide que usuarios autenticados lean la tabla de roles directamente; la falta de `GRANT UPDATE` en `participants` impide mutaciones de identidad.
2. **Capa 2 — Políticas de seguridad a nivel de fila (Row Level Security - RLS):**
   - Gobierna la visibilidad y mutabilidad de registros específicos dentro de tablas donde el rol ya cuenta con los grants relacionales necesarios.
   - **Distinción obligatoria entre cláusulas de RLS y restricciones (0 filas no es universal):**
     * **Cláusula `USING` (Filtrado silencioso de lectura/alcance):** En `SELECT`, o en sentencias `UPDATE`/`DELETE` donde las filas existentes no cumplen la condición `USING`, PostgreSQL no lanza error sino que procesa un conjunto vacío, retornando 0 filas devueltas o 0 filas afectadas con código de éxito SQL.
     * **Cláusula `WITH CHECK` (Validación de nuevas mutaciones):** En `INSERT`, o en `UPDATE` sobre filas existentes que sí pasan `USING` pero cuyos nuevos valores violan la condición `WITH CHECK`, PostgreSQL **no devuelve 0 filas**, sino que aborta la sentencia con una excepción de violación de política RLS (código SQL `42501: new row violates row-level security policy`).
     * **Restricciones de integridad y Triggers:** Si una operación vulnera restricciones relacionales (claves foráneas, constraints `CHECK`, `NOT NULL`) o activa triggers de integridad relacional (como validaciones defensivas de inmutabilidad), el motor aborta con sus propios errores (`check_violation`, `foreign_key_violation`, `raise_exception`), independientemente de RLS.
   - **No sustituye a los privilegios relacionales:** Si no se otorgan o se revocan grants de tabla/columna, RLS no llega a evaluarse; y a la inversa, un grant amplio a nivel de tabla no exime de definir políticas RLS estrictas.
3. **Capa 3 — Autorización en la aplicación (Next.js Middleware, Server Components y Server Actions):**
   - Gobierna el control de flujo en el servidor web antes de que las consultas lleguen a la base de datos: verificación de cookies de sesión, gates de navegación en `src/proxy.ts`, renderizado condicional de componentes administrativos y validaciones defensivas en Server Actions.
   - En Server Components: previene la exposición de datos confidenciales y renderizado de controles administrativos en el HTML.
   - En Server Actions: valida de forma temprana (`isAdmin()`) para abortar peticiones no autorizadas en cortocircuito (`fail-closed`), evitando carga innecesaria en la base de datos y ofreciendo respuestas claras (`{ error: "No autorizado" }`).
   - **No sustituye a RLS ni a los grants SQL:** Si la aplicación sufre una vulnerabilidad de lógica, desvío de control o si un atacante interactúa directamente con la API PostgREST mediante un token legítimo, RLS y los grants de PostgreSQL constituyen la barrera infranqueable de última instancia.

> [!IMPORTANT]
> **Aclaración sobre códigos HTTP de PostgREST:**  
> Todos los códigos HTTP indicados para PostgREST constituyen **resultados técnicos previstos según la especificación de PostgREST** y están expresamente catalogados como **hipótesis por verificar empíricamente** durante la ejecución en el entorno local aislado de Supabase:
> - **Error `42501` (permisos de PostgreSQL):** PostgREST mapea habitualmente esta denegación a `HTTP 403 Forbidden` cuando la petición incluye un token con rol `authenticated`, o a `HTTP 401 Unauthorized` si la petición carece de credenciales o el token no es válido.
> - **Filtro RLS silencioso (`USING` no coincide):** En operaciones `SELECT`, `UPDATE` o `DELETE`, si la política RLS oculta los registros vía `USING`, PostgreSQL procesa 0 filas sin emitir error. PostgREST devuelve por defecto `HTTP 200 OK` con un cuerpo vacío `[]` (salvo que se soliciten cabeceras singulares como `Accept: application/vnd.pgrst.object+json`, que podrían producir 404 o 406).
> - **Violaciones de `WITH CHECK`, restricciones o triggers plpgsql:** Las violaciones de `WITH CHECK` suelen generar `HTTP 403 Forbidden` o `HTTP 400 Bad Request`, mientras que restricciones de integridad o excepciones de triggers (`raise_exception`) se traducen habitualmente en `HTTP 400 Bad Request` o `HTTP 409 Conflict`.

### 8.2. Matriz de pruebas en Base de Datos: SQL Directo vs PostgREST HTTP

| ID | Actor Sintético | Capa de Seguridad Evaluada | Acción / Consulta | Resultado SQL Directo (psql) | Resultado PostgREST HTTP *(previsto, por verificar)* | Causa / Regla Activa |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DB-NEG-01** | Usuario B (Organizador) | **Privilegios SQL (GRANT/REVOKE)** | `SELECT * FROM public.user_roles;` | **Error `42501`** (`permission denied for table user_roles`) | **[Por verificar] `HTTP 403 Forbidden`** *(o 401 si no hay token)* | Falta de `GRANT SELECT` a `authenticated`. |
| **DB-NEG-02** | Usuario D (Anon) | **Privilegios SQL (GRANT/REVOKE)** | `SELECT public.is_admin();` | **Error `42501`** (`permission denied for function is_admin`) | **[Por verificar] `HTTP 403 Forbidden`** *(o 401 si anónimo)* | Revocación explícita de `EXECUTE` a `anon` y `PUBLIC`. |
| **DB-NEG-03** | Usuario B (Organizador) | **Políticas RLS (Cláusula USING)** | `SELECT * FROM activities WHERE id = '<actividad_2_id>';` | **`SELECT 0`** (0 filas devueltas) | **[Por verificar] `HTTP 200 OK`** con cuerpo `[]` (array vacío) | Política RLS `using (owner_id = auth.uid())` oculta la fila. |
| **DB-NEG-04** | Usuario B (Organizador) | **Políticas RLS (Cláusula USING)** | `UPDATE activities SET status = 'closed' WHERE id = '<actividad_2_id>';` | **`UPDATE 0`** (0 filas afectadas) | **[Por verificar] `HTTP 200 OK`** con cuerpo `[]` (0 filas modificadas) | RLS `USING` no matchea; omite la fila silenciosamente. |
| **DB-NEG-05** | Usuario B (Organizador) | **Políticas RLS (Cláusula USING)** | `DELETE FROM activities WHERE id = '<actividad_2_id>';` | **`DELETE 0`** (0 filas afectadas) | **[Por verificar] `HTTP 200 OK`** con cuerpo `[]` (0 filas eliminadas) | RLS `USING` no coincide con el dueño. |
| **DB-NEG-06** | Usuario B (Organizador) | **Políticas RLS (Cláusula USING)** | `UPDATE ideas SET status = 'hidden' WHERE id = '<idea_actividad_2_id>';` | **`UPDATE 0`** (0 filas afectadas) | **[Por verificar] `HTTP 200 OK`** con cuerpo `[]` (0 filas modificadas) | RLS en `ideas` no coincide con el organizador. |
| **DB-NEG-07** | Usuario A (Admin) | **Privilegios SQL (GRANT/REVOKE)** | `UPDATE participants SET first_name = 'hack' WHERE id = '...';` | **Error `42501`** (`permission denied for table participants`) | **[Por verificar] `HTTP 403 Forbidden`** | `authenticated` carece de `GRANT UPDATE` en `participants`. |
| **DB-NEG-08** | Usuario A (Admin) | **Privilegios SQL (GRANT/REVOKE)** | `DELETE FROM participants WHERE id = '...';` | **Error `42501`** (`permission denied for table participants`) | **[Por verificar] `HTTP 403 Forbidden`** | `authenticated` carece de `GRANT DELETE` en `participants`. |
| **DB-POS-01** | Usuario A (Admin) | **Función Autorizadora SQL** | `SELECT public.is_admin();` | **Retorna `true`** (1 fila, valor `t`) | **[Por verificar] `HTTP 200 OK`** con cuerpo `true` | Coincidencia en `public.user_roles` con rol `admin_global`. |
| **DB-POS-02** | Usuario B (Organizador) | **Función Autorizadora SQL** | `SELECT public.is_admin();` | **Retorna `false`** (1 fila, valor `f`) | **[Por verificar] `HTTP 200 OK`** con cuerpo `false` | Ausencia de fila en `public.user_roles`. |
| **DB-POS-03** | Usuario A (Admin) | **Políticas RLS (Cláusula USING)** | `SELECT id FROM activities;` | **`SELECT N`** (retorna el total global de actividades) | **[Por verificar] `HTTP 200 OK`** con array de N objetos | Política RLS aditiva `using (public.is_admin())` evalúa a `true`. |
| **DB-POS-04** | Usuario A (Admin) | **Políticas RLS (Cláusula USING)** | `UPDATE activities SET status = 'closed' WHERE id = '<actividad_2_id>';` | **`UPDATE 1`** (exactamente 1 fila afectada) | **[Por verificar] `HTTP 200 OK`** con cuerpo confirmando 1 registro | Política RLS aditiva permite mutación global. |
| **DB-POS-05** | Usuario A (Admin) | **Políticas RLS (Cláusula USING)** | `UPDATE ideas SET status = 'hidden' WHERE id = '<idea_actividad_2_id>';` | **`UPDATE 1`** (exactamente 1 fila afectada) | **[Por verificar] `HTTP 200 OK`** con cuerpo confirmando 1 registro | Política RLS aditiva permite moderación global. |
| **DB-POS-06** | Usuario A (Admin) | **Políticas RLS (Cláusula USING)** | `SELECT * FROM participants WHERE activity_id = '<actividad_2_id>';` | **`SELECT K`** (filas de participantes devueltas) | **[Por verificar] `HTTP 200 OK`** con array de participantes | Solo lectura permitida por política aditiva RLS. |
| **DB-POS-07** | Usuario A (Admin) | **Políticas RLS (Cláusula USING)** | `SELECT * FROM idea_authors WHERE activity_id = '<actividad_2_id>';` | **`SELECT M`** (filas de autoría devueltas) | **[Por verificar] `HTTP 200 OK`** con array de vínculos de autoría | Solo lectura permitida por política aditiva RLS. |

### 8.3. Matriz de pruebas en Aplicación (Next.js App Router)

| ID | Actor Sintético | Capa de Seguridad Evaluada | Punto de Entrada / Acción | Resultado Observado en Aplicación | Mecanismo de Defensa en Aplicación y Respaldo RLS |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **APP-NEG-01** | Anónimo (sin sesión) | **Autorización en Aplicación (Middleware)** | GET `/admin` o `/admin/actividades/[id]` | Redirección HTTP 307 a `/ingresar` | Gate en `src/proxy.ts` (middleware por cookie). RLS actúa como respaldo si se invoca directo. |
| **APP-NEG-02** | Usuario B (Organizador) | **Autorización en Aplicación (Server Component)** | GET `/admin` | Redirección a `/panel` o HTTP 403 / `notFound()` | Server Component valida rol fresco en servidor. RLS devolvería 0 filas ajenas si se omitiera. |
| **APP-NEG-03** | Usuario B (Organizador) | **Autorización en Aplicación (Server Component)** | GET `/admin/actividades/<actividad_2_id>` | Redirección o 403; sin renderizado de controles admin | Server Component valida rol antes de emitir HTML. RLS filtra la actividad ajena en BD. |
| **APP-NEG-04** | Usuario B (Organizador) | **Autorización en Aplicación (Server Action)** | POST a Server Action administrativa con payload forzado | Retorna `{ error: "No autorizado" }` sin mutar BD | Validación defensiva en servidor (`isAdmin()`). Si se evadiera, RLS afectaría 0 filas. |
| **APP-POS-01** | Usuario A (Admin) | **Autorización en Aplicación (Server Component)** | GET `/admin` | Renderiza Dashboard global con listado de todas las actividades | Server Component autoriza y RLS aditiva permite lectura global. |
| **APP-POS-02** | Usuario A (Admin) | **Autorización en Aplicación (Server Component)** | GET `/admin/actividades/<actividad_2_id>` | Renderiza detalle de actividad ajena y controles | Server Component autoriza y RLS aditiva permite lectura de actividad ajena. |
| **APP-POS-03** | Usuario A (Admin) | **Autorización en Aplicación (Server Action)** | POST a Server Action administrativa (moderar/cerrar) | Operación ejecutada con éxito y revalidación de path | Server Action autoriza en servidor y RLS permite la mutación global. |

### 8.4. Pruebas dinámicas de la bitácora de auditoría transaccional

Con la preparación del DDL en `20261018040000_admin_global_authorization.sql`, la bitácora `public.audit_logs` y sus triggers quedan integrados en la matriz de pruebas.

| ID | Capa Evaluada | Acción / Mutación | Resultado Esperado en PostgreSQL | Criterio de Aceptación / Invariante |
| :--- | :--- | :--- | :--- | :--- |
| **AUDIT-DYN-01** | Triggers / Bitácora | Usuario A muta estado de actividad ajena (`status = 'closed'`) | Se inserta exactamente 1 fila en `public.audit_logs` con `action = 'activity_status_change'` | `payload` incluye `'actor_id_snapshot': <UUID_A>`, `old_status`, `new_status` y marcas de tiempo. |
| **AUDIT-DYN-02** | Triggers / Bitácora | Usuario A modera idea ajena (`status = 'hidden'`) | Se inserta exactamente 1 fila en `public.audit_logs` con `action = 'idea_moderate_status'` | `payload` incluye `'actor_id_snapshot': <UUID_A>`, `activity_id`, `old_status`, `new_status` y `content_length`. |
| **AUDIT-DYN-03** | Triggers / Integridad | Usuario A elimina idea individualmente (`DELETE FROM ideas WHERE id = ...`) | Se inserta exactamente 1 fila en `public.audit_logs` con `action = 'idea_delete_individual'` | La condición `parent_exists` evalúa a `true` al existir la actividad padre. |
| **AUDIT-DYN-04** | Triggers / Supresión | Usuario A elimina actividad raíz (`DELETE FROM activities WHERE id = ...`) | Se inserta exactamente 1 fila con `action = 'activity_delete'`; **cero filas** de `idea_delete_individual` | `parent_exists` evalúa a `false` durante la cascada interna de PostgreSQL, suprimiendo duplicados. |
| **AUDIT-DYN-05** | Integridad Referencial | Se elimina la cuenta de Usuario A en `auth.users` (`DELETE FROM auth.users WHERE id = <UUID_A>`) | En `public.audit_logs`: columna `actor_id` pasa a `NULL` (`ON DELETE SET NULL`), pero `payload->>'actor_id_snapshot'` **permanece intacto** | Preservación de la referencia histórica de identidad ante purga de usuarios sin violar constraints. |
| **AUDIT-DYN-06** | Atomicidad ACID | Se intenta forzar una excepción durante la mutación de una actividad | Si la sentencia aborta, no se registra ninguna fila huérfana en `public.audit_logs` | Mutación y auditoría residen en la misma transacción relacional (`AFTER UPDATE/DELETE`). |

> [!NOTE]
> **Minimización de datos y naturaleza del UUID:** En todos los eventos auditados, el snapshot almacena únicamente el UUID sintético. No se capturan correos electrónicos, nombres ni direcciones IP. El UUID es una referencia histórica de correlación, no una prueba criptográfica de identidad, y credenciales con privilegios elevados de infraestructura (`postgres`, `service_role`) pueden alterar la bitácora si el motor es vulnerado.

---

## 9. Ruta referencial real de `idea_authors` y protocolo de eliminación en cascada

### 9.1. Arquitectura referencial en el esquema actual
De acuerdo con las migraciones históricas versionadas (`20261002080804_initial_data_model.sql`):
- La tabla `public.idea_authors` vincula de forma privada una idea con su autor participante.
- `idea_authors` **NO** posee una clave foránea simple directa a `activities(id)`.
- Sus restricciones de clave foránea son compuestas y se apoyan en `ideas` y `participants`:
  1. `constraint idea_authors_activity_idea_fkey foreign key (activity_id, idea_id) references public.ideas (activity_id, id) on delete cascade`
  2. `constraint idea_authors_activity_participant_fkey foreign key (activity_id, participant_id) references public.participants (activity_id, id) on delete cascade`
- A su vez, tanto `ideas` como `participants` tienen claves foráneas directas hacia `activities(id)` con `ON DELETE CASCADE`:
  - `ideas.activity_id references public.activities(id) on delete cascade`
  - `participants.activity_id references public.activities(id) on delete cascade`

```mermaid
graph TD
    A[public.activities] -->|ON DELETE CASCADE| P[public.participants]
    A -->|ON DELETE CASCADE| I[public.ideas]
    P -->|ON DELETE CASCADE activity_id, participant_id| IA[public.idea_authors]
    I -->|ON DELETE CASCADE activity_id, idea_id| IA
```

### 9.2. Procedimiento riguroso de prueba de cascada (CASCADE-01)
1. **Precondición:**
   - Instanciar una actividad sintética `ACT_TEST` con:
     - 2 participantes (`PART_1`, `PART_2`) en `public.participants`.
     - 3 ideas (`IDEA_1`, `IDEA_2`, `IDEA_3`) en `public.ideas`.
     - 3 registros de vinculación en `public.idea_authors` asociando las ideas con los participantes bajo `ACT_TEST`.
   - Comprobar que existen registros activos con:
     ```sql
     SELECT count(*) FROM public.activities WHERE id = '<ACT_TEST>';     -- Esperado: 1
     SELECT count(*) FROM public.participants WHERE activity_id = '<ACT_TEST>'; -- Esperado: 2
     SELECT count(*) FROM public.ideas WHERE activity_id = '<ACT_TEST>';        -- Esperado: 3
     SELECT count(*) FROM public.idea_authors WHERE activity_id = '<ACT_TEST>'; -- Esperado: 3
     ```
2. **Acción de eliminación global:**
   - El Usuario A (`admin_global`) ejecuta la eliminación de la actividad:
     `DELETE FROM public.activities WHERE id = '<ACT_TEST>';`
3. **Verificación exhaustiva de ausencia de huérfanos (Queries directas en PostgreSQL):**
   - `SELECT count(*) FROM public.activities WHERE id = '<ACT_TEST>';` → **0 filas**.
   - `SELECT count(*) FROM public.participants WHERE activity_id = '<ACT_TEST>';` → **0 filas**.
   - `SELECT count(*) FROM public.ideas WHERE activity_id = '<ACT_TEST>';` → **0 filas**.
   - `SELECT count(*) FROM public.idea_authors WHERE activity_id = '<ACT_TEST>';` → **0 filas**.
4. **Criterio de validación:** La eliminación en cascada de `activities` debe limpiar de forma transitiva y completa las tablas intermedias (`ideas`, `participants`) y la tabla hoja compuesta (`idea_authors`) sin violaciones de clave foránea ni registros residuales.

---

## 10. Protocolo de revocación de rol: Identidad sintética, servidor fresco y UI en caché

La revocación de privilegios debe probarse bajo un modelo de amenaza donde un usuario al que se le ha retirado el rol administrativo intente explotar artefactos residuales o sesiones activas en su cliente.

### 10.1. Insuficiencia de las directivas de caché de Next.js como prueba de frescura

> [!WARNING]
> **Las directivas de caché de Next.js no demuestran por sí solas la frescura de la autorización:**  
> Declarar directivas como `no-store`, `revalidate = 0` o `export const dynamic = 'force-dynamic'` es una precondición necesaria pero **insuficiente** para certificar que la autorización no emplee datos obsoletos:
> 1. **Ámbito limitado:** Las directivas de segmento de Next.js aplican a la capa de caché de respuestas HTTP y solicitudes fetch, pero no impiden que el código en ejecución lea un claim estático residual en un JWT ya emitido, una cookie de sesión desfasada o una variable memorizada en el proceso Node.js.
> 2. **Desacoplamiento de Server Actions:** Las Server Actions se ejecutan como endpoints POST (RPC) independientes de los Page Segments; no se rigen automáticamente por las directivas de caché de una página específica.
> 3. **Riesgo de atajos lógicos:** Si una función de autorización valida la sesión usando información desactualizada antes de consultar la base de datos relacional, la presencia de directivas de caché resulta completamente inocua.

Por lo tanto, la frescura de la autorización en cada petición debe definirse y comprobarse mediante **criterios verificables de ejecución en servidor**.

### 10.2. Requisitos verificables de comprobación fresca de rol

Para asegurar que ni las rutas administrativas ni las Server Actions procedan con datos de rol obsoletos:

1. **Desacoplamiento estricto de JWT y cookies mutables:**
   El rol `admin_global` no se emite como un claim estático en el JWT de Supabase Auth ni se almacena en cookies de cliente. La única fuente autoritativa del rol es la tabla relacional `public.user_roles` (o la función `public.is_admin()`).
2. **Consulta fresca por ciclo de petición (Zero-Cache en autorización):**
   - Toda invocación de Server Actions administrativas y todo renderizado de Server Components bajo rutas `/admin` debe ejecutar una consulta fresca y directa a la base de datos para verificar el rol del usuario autenticado (`auth.uid()`).
   - Queda formal y terminantemente **prohibido el uso de `unstable_cache`**, variables globales en memoria de Node.js o memorizaciones estáticas entre peticiones para la autorización de roles.
3. **Evaluación como guardia preliminar en cortocircuito (Fail-Closed):**
   - En toda Server Action administrativa, la verificación del rol debe ser la primera operación lógica ejecutada.
   - Si la consulta fresca indica que el usuario ya no posee `admin_global` (o si la consulta a la BD falla), la acción debe abortar de inmediato devolviendo `{ error: "No autorizado" }`, **antes de parsear datos de entrada, ejecutar lecturas de negocio o realizar cualquier mutación**.

### 10.3. Precondición obligatoria de aislamiento y verificación de identidad antes de mutaciones SQL

Antes de ejecutar cualquier instrucción SQL que altere roles o registros (en particular `DELETE FROM public.user_roles`), es mandatorio cumplir rigurosamente con la siguiente precondición de seguridad:

1. **Aislamiento verificado del entorno local desechable:**
   - Comprobar en la sesión de base de datos activa que la conexión corresponde inequívocamente al contenedor local de pruebas de Supabase (`http://127.0.0.1:25435` / puerto PostgreSQL local `25433`), validando variables de conexión y asegurando la ausencia total de enlaces hacia staging, producción o la rama de integración.
2. **Verificación de identidad sintética y pre-estado:**
   - Comprobar que el identificador `user_id` a mutar o revocar pertenezca exclusivamente a la cuenta sintética de prueba del Usuario A (`admin.test@synthetic.local`):
     ```sql
     -- Precondición: comprobar actor sintético y existencia previa del rol
     SELECT u.id, u.email, r.role
     FROM auth.users u
     JOIN public.user_roles r ON r.user_id = u.id
     WHERE u.email = 'admin.test@synthetic.local';
     -- Debe retornar exactamente 1 fila con role = 'admin_global'
     ```
   - Si la consulta arroja un identificador desconocido, cero filas o una cuenta ajena al set sintético, la operación debe detenerse de inmediato sin realizar ninguna mutación.

### 10.4. Definición de procedimientos propuestos para la verificación empírica de frescura (Pendientes de ejecución)

Los siguientes procedimientos representan el diseño experimental propuesto para someter a prueba la frescura de la autorización en una fase posterior. **Se mantienen formalmente como procedimientos pendientes de ejecución empírica, no como evidencia ya obtenida:**

#### Frente A: Verificación propuesta en Server Actions antes de cualquier mutación (TEST-FRESH-ACTION)
- **Objetivo metodológico:** Comprobar que una Server Action administrativa no autorice mutaciones si el rol fue revocado, incluso conservando la misma sesión activa en el cliente.
- **Procedimiento propuesto por ejecutar:**
  1. *Paso experimental 1:* El Usuario A (`admin_global`) inicia sesión y emite una mutación administrativa legítima (ej. cerrar actividad ajena) -> resultado previsto: éxito (`status: 'closed'`).
  2. *Paso experimental 2:* En la consola SQL de PostgreSQL, tras validar la precondición de aislamiento (§10.3), se ejecuta la revocación del rol en la base de datos:
     ```sql
     DELETE FROM public.user_roles WHERE user_id = '<UUID_USUARIO_A>';
     ```
  3. *Paso experimental 3:* **Sin cerrar sesión ni reautenticar** en el cliente (manteniendo el mismo JWT y cookies intactos), se despacha inmediatamente una invocación POST a una Server Action administrativa (ej. moderar idea ajena a `hidden`).
  4. *Resultado previsto por verificar empíricamente:*
     - La Server Action debe consultar la BD de forma fresca, comprobar que `public.is_admin()` o `public.user_roles` retorna `false`/vacío y abortar inmediatamente devolviendo `{ error: "No autorizado" }`.
     - Se verificará en la base de datos mediante consulta directa en PostgreSQL que el campo `ideas.status` permanece inalterado, demostrando que no se ejecutó ninguna sentencia de mutación antes ni durante la validación del rol.

#### Frente B: Verificación propuesta en Rutas Administrativas contra datos obsoletos (TEST-FRESH-ROUTE)
- **Objetivo metodológico:** Comprobar que los Server Components bajo `/admin` no expongan datos confidenciales ni rendericen vistas administrativas tras la revocación del rol.
- **Procedimiento propuesto por ejecutar:**
  1. *Paso experimental 1:* Con el rol revocado en la base de datos conforme al paso anterior y conservando la sesión activa en el navegador, se realiza una petición GET directa a `/admin` o `/admin/actividades/[id]`.
  2. *Resultado previsto por verificar empíricamente:*
     - El Server Component ejecuta la consulta fresca a la BD antes de invocar lecturas de actividades ajenas.
     - Al detectar la ausencia de `admin_global`, el Server Component no debe emitir HTML con datos administrativos y debe retornar inmediatamente una redirección HTTP 307 a `/panel` (o un error HTTP 403 / `notFound()`).
     - Se verificará en el cuerpo de la respuesta HTTP la ausencia absoluta de entidades ajenas filtradas hacia el cliente.

### 10.5. Distinción explícita de planos ante revocación (REVOC-01)

Se distingue formalmente la autoridad de ejecución en el servidor frente a la visualización transitoria en el cliente:

```
[ Navegador Cliente (Plano 2) ]                 [ Servidor Next.js & PostgreSQL (Plano 1) ]
  UI en Router Cache (Obsolescente)                Verificación de rol fresca (Autoritativo)
          │                                                          │
          │─── POST Server Action (botón admin) ────────────────────>│
          │                                                          │──> SELECT is_admin() --> false!
          │                                                          │    (Abort fail-closed sin mutar)
          │<── Retorna { error: "No autorizado" } ───────────────────│
          │    (Base de datos intacta)                               │
          │                                                          │
          │─── Recarga F5 / Navegación dura ────────────────────────>│
          │                                                          │──> Server Component evalúa false
          │<── HTTP 307 Redirect a /panel (o 403) ───────────────────│
```

#### Plano 1: Autorización autoritativa en Servidor y Base de Datos (Inmediata y vinculante)
- **Efecto instantáneo:** Al ejecutar la revocación en base de datos (`DELETE FROM public.user_roles WHERE user_id = '<UUID_USUARIO_A>';`), la siguiente consulta SQL ejecutada en nombre del Usuario A evaluará `public.is_admin()` a `false`.
- **Inmunidad a mutaciones:** Cualquier Server Action administrativa invocada tras la revocación consulta la base de datos de manera fresca, detecta la pérdida del rol y rechaza la petición en el acto. La base de datos queda protegida de inmediato.

#### Plano 2: Caché visual del Navegador Cliente (UI obsoleta transitoria y sin autoridad)
- **Artefacto cliente:** El navegador del Usuario A puede retener en memoria DOM o en el Router Cache del cliente la página `/admin` previamente cargada si el usuario no refresca la pestaña. Los botones de acción administrativa pueden permanecer temporalmente visibles.
- **Inocuidad de la UI residual:** La interfaz visual no confiere autoridad alguna. Si el usuario intenta accionar un botón administrativo desde esa pantalla obsoleta, la petición es rechazada de inmediato por el Plano 1 en el servidor.
- **Sincronización visual:** Ante cualquier recarga de página (F5) o navegación dura, el Server Component reevalúa la ruta en servidor y expulsa al usuario fuera de `/admin` (redirección a `/panel` o respuesta HTTP 403).

---

## 11. Criterios objetivos de aceptación y registro de resultados

1. **Tasa de éxito del 100%:** Todas las pruebas propuestas (negativas, positivas y de frescura) deberán bloquear o permitir según especificación una vez que se autorice y complete su ejecución.
2. **Cero regresiones en organizadores:** Las pruebas `REG-ORG-*` deben aprobarse en su totalidad sin modificaciones en el comportamiento de `/panel`.
3. **Inmutabilidad de `owner_id` demostrada:** Ninguna llamada administrativa debe permitir alterar el propietario de una actividad (`NEG-IMMUT-01`).
4. **Segregación de auditoría:** La aceptación funcional de autorización no requiere ni depende de la implementación de la bitácora de auditoría.
5. **Independencia de capas:** La superación de pruebas de aplicación no sustituye ni convalida las pruebas de RLS o privilegios SQL, las cuales deben aprobarse independientemente.
6. **Plantilla de registro de ejecución:**
   Los resultados futuros deberán consignarse en un informe bajo la siguiente estructura estandarizada:
   - **ID de prueba:**
   - **Capa evaluada:** `[Privilegios SQL (GRANT/REVOKE) | Políticas RLS | Autorización en Aplicación | API PostgREST]`
   - **Fecha y hora de ejecución:**
   - **Entorno / Versión de Supabase CLI:**
   - **Actor sintético ejecutante:**
   - **Dimensiones de identidad verificadas:** `[Rol PG: ... | JWT Claims: ... | Actor UUID: ...]`
   - **Entrada / Comando emitido:**
   - **Resultado esperado vs. obtenido:**
   - **Estado:** `APROBADO (PASS)` / `FALLIDO (FAIL)` / `BLOQUEADO (BLOCKED)`
   - **Evidencia anexa:** Log de consola / código HTTP / respuesta PostgreSQL.

---

## 12. Distinciones epistemológicas y riesgos no verificables en solo lectura

### 12.1. Clasificación estricta del conocimiento actual

Para garantizar rigor metodológico, se clasifican los enunciados en tres categorías:

#### A. Hechos ya verificados en el repositorio (Certezas técnicas documentadas):
- **Integridad referencial actual:** Las tablas `activities`, `participants`, `ideas` e `idea_authors` cuentan con restricciones de clave foránea con `ON DELETE CASCADE` definidas en `20261002080804_initial_data_model.sql`.
- **Ruta referencial de autoría:** `idea_authors` no se conecta directamente a `activities`, sino a través de claves compuestas con `ideas` y `participants`.
- **Grants actuales:** El rol `authenticated` tiene grants completos de tabla en `activities`, pero solo `SELECT, UPDATE, DELETE` en `ideas`, y únicamente `SELECT` en `participants` e `idea_authors`. No tiene grants de `INSERT` directo en `ideas` ni en `participants` (reservados a la función RPC `submit_idea`).
- **Grant general de tabla sobre activities:** `authenticated` posee `GRANT UPDATE` general en toda la tabla `activities` ([initial_data_model.sql:97](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/supabase/migrations/20261002080804_initial_data_model.sql#L97)), lo que invalida grants de columna si no se revoca previamente dicho grant de tabla.
- **Trigger existente en ideas:** `ideas_update_published_at` ([initial_data_model.sql:296](file:///c:/Users/lucas/Desktop/Proyectos%20de%202026/Muro%20Partisiativo%20de%20Ideas/supabase/migrations/20261002080804_initial_data_model.sql#L296)) actualiza automáticamente `published_at` al modificar `status`.
- **Proxy existente:** `src/proxy.ts` intercepta peticiones en servidor y redirecciona según presencia de sesión.
- **Compilación e integridad estática:** `tsc` y `next build` pasan con cero errores en el commit `0a12e2a`.

#### B. Inferencias técnicas y decisiones pendientes de validación / implementación:
- **Decisión pendiente 1 — Mecanismo definitivo de inmutabilidad de `activities.owner_id`:** Elección entre grants por columna (con revocación previa del grant de tabla y compatibilidad con triggers de marcas temporales) frente a trigger defensivo `BEFORE UPDATE`.
- **Decisión pendiente 2 — Bitácora de auditoría administrativa:** Especificación, diseño DDL, arquitectura de captura (síncrona vs asíncrona) y retención de una tabla de auditoría (`audit_logs`), inexistente en el repositorio actual.
- **Decisión pendiente 3 — Verificación empírica de códigos HTTP de PostgREST:** Los códigos HTTP (403 vs 401, arrays vacíos en 200, etc.) detallados en §8.2 son previsiones teóricas que deben demostrarse empíricamente contra el runtime de PostgREST en Supabase local.
- **Decisión pendiente 4 — Interacción con Realtime:** El impacto de que un administrador cierre una actividad ajena sobre la suscripción WebSocket del muro público (`/muro/[code]`) debe confirmarse mediante pruebas funcionales con clientes concurrentes.
- **Decisión pendiente 5 — Migración e implementación definitiva de `user_roles`:** Toda la infraestructura de roles (`public.user_roles`, `public.is_admin()`) es una propuesta técnica y no existe aún en la base de datos local ni remota.

#### C. Pruebas propuestas aún no ejecutadas (Diseño experimental pendiente de autorización y ejecución):
- Todas las pruebas `DB-*`, `APP-*`, `CASCADE-01`, `REVOC-01`, `TEST-FRESH-ACTION` y `TEST-FRESH-ROUTE` descritas en este documento son **procedimientos propuestos pendientes de ejecución experimental futura** y **no constituyen evidencia ya obtenida** en esta fase documental.

### 12.2. Verificaciones imposibles de realizar en modo solo lectura:
- **Evaluación dinámica del planificador de PostgreSQL:** No es posible medir el costo ni el comportamiento de consultas RLS con subconsultas `is_admin()` sin una base de datos activa con datos sintéticos.
- **Comportamiento del Router Cache del cliente frente a revocación:** Requiere levantar la aplicación Next.js en el navegador, emitir cookies de autenticación, alterar la base de datos y observar las transiciones de pantalla del usuario en tiempo de ejecución.
- **Validación de respuestas HTTP y serialización en PostgREST:** Exige interactuar mediante HTTP con el daemon local de Supabase.



