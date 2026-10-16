# Ficha de Seguimiento — Etapa 3: Verificación Funcional y Matriz de Aceptación

- **Proyecto:** Muro Participativo de Ideas
- **Etapa:** 3 — Verificación funcional y matriz de aceptación
- **Rama de trabajo conocida:** `feat/pagina-administracion`
- **Commit funcional de la Etapa 2:** `b77068a0fbb82e9311c8a4886cd676f9c62f2f0a`
- **Commit documental de cierre de la Etapa 2:** `c7cd05d4c01fa0a922d8ab0c4e2f017dcba0511a`
- **Último estado conocido de ramas base:** `main` y `develop` en `4278c11bcef3fc00a528cca424df21bad6e28e10`
- **Entorno local informado:** Next.js en `http://localhost:3000` y Supabase local en `127.0.0.1:25435` (contenedores Docker)
- **Estado documental de la Etapa 3:** Plan documentado; ejecución pendiente
- **Responsable:** Antigravity

---

## 1. Contexto y estado inicial

Esta ficha establece formalmente el plan de pruebas de aceptación y verificación funcional para la Etapa 3 del proyecto Muro Participativo de Ideas, actualizado tras la inspección técnica de seguridad realizada sobre el código fuente, las migraciones y los metadatos de la instancia local de PostgreSQL.

Los datos de referencia corresponden al estado verificado en el repositorio:
- **Rama activa:** `feat/pagina-administracion`.
- **Base de desarrollo:** Originada a partir del commit `4278c11bcef3fc00a528cca424df21bad6e28e10`, el cual se conserva intacto en las ramas `main` y `develop`.
- **Implementación de la Etapa 2:** Versionada en `feat/pagina-administracion` bajo el commit funcional `b77068a0fbb82e9311c8a4886cd676f9c62f2f0a` y el commit de cierre documental `c7cd05d4c01fa0a922d8ab0c4e2f017dcba0511a`.
- **Entorno de ejecución:** Aplicación web ejecutándose en `http://localhost:3000` (`next dev`) y servicios backend provistos localmente por Supabase CLI a través de Docker en `http://127.0.0.1:25435`.

*(Nota de alcance: Las comprobaciones de metadatos de base de datos se refieren estrictamente a la instancia local de desarrollo y no deben extrapolarse a entornos de producción u otras bases de datos. Este documento no almacena ni expone claves, tokens, contraseñas, cookies ni credenciales secretas).*

---

## 2. Objetivo y alcance

### 2.1 Objetivo general
Comprobar de manera rigurosa, reproducible y documentada que las correcciones de administración, los flujos de moderación, la seguridad de las Server Actions y el aislamiento de datos implementados en la Etapa 2 funcionan conforme a las especificaciones aprobadas en un entorno de ejecución real (Next.js conectado a base de datos PostgreSQL/Supabase local con políticas RLS activas).

### 2.2 Alcance funcional incluido
1. **Autenticación del organizador:** Inicio de sesión legítimo en la ruta real `/ingresar` y persistencia observable de sesión.
2. **Autorización y control de acceso:** Redirección automática inmediata hacia `/ingresar` ante cualquier intento no autenticado de ingresar a `/panel` o invocar Server Actions privadas.
3. **Propiedad de actividades y aislamiento:** Verificación de que ningún organizador pueda visualizar, editar, moderar ni eliminar actividades o ideas de otro organizador.
4. **Flujos de moderación en ambos modos:**
   - Aprobación y resolución de ideas pendientes tanto en modo `approval` («Aprobar idea») como en modo `automatic` («Publicar idea»).
   - Rechazo de ideas pendientes («Rechazar idea») hacia estado `hidden`.
   - Ocultamiento de ideas publicadas («Ocultar del muro»).
   - Republicación de ideas previamente ocultas («Volver a mostrar en el muro»).
5. **Persistencia e integridad en PostgreSQL:** Comprobación funcional del trigger `ideas_update_published_at` sobre el campo `published_at` (`now()` al publicar, `NULL` al ocultar o rechazar, y nueva marca al republicar).
6. **Políticas RLS en base de datos:** Verificación dinámica y efectiva con sesiones reales independientes (no privilegios de superusuario) de que RLS aísla consultas y mutaciones.
7. **Visibilidad en el muro público:** Garantía de que la ruta real `/muro/[code]` (donde `code` es el `public_code` alfanumérico de 8 caracteres de la actividad) expone exclusivamente ideas en estado `published`, omitiendo `pending` y `hidden`.
8. **Diseño adaptable:** Comprobación visual real de que la interfaz del panel y del muro responde adecuadamente en escritorio (1280px+) y móvil (375px), sin roturas ni desbordamientos.

### 2.3 Exclusiones expresas (Fuera de alcance)
- No se desarrollarán nuevas funcionalidades ni cambios de diseño no contemplados.
- No se realizarán modificaciones de código funcional durante la fase de ejecución de pruebas. En caso de detectarse discrepancias o defectos, estos se registrarán formalmente en la ficha para su tratamiento posterior.
- No se instalarán dependencias de software ni paquetes adicionales.
- No se realizarán fusiones (`merge`), rebasificaciones (`rebase`), cambios de rama ni sincronizaciones remotas (`git push`).
- No se realizarán despliegues ni publicaciones a entornos de producción o staging.

---

## 3. Estado de trazabilidad técnica (Fuentes de evidencia y clasificación)

Se establece una diferenciación rigurosa entre lo confirmado mediante inspección técnica y lo que permanece pendiente de ejecución funcional, bajo los siguientes principios fundamentales:
- **Permisos SQL vs. Políticas RLS:** Los permisos SQL determinan qué operaciones (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) y sobre qué columnas específicas puede actuar cada rol de base de datos. Por su parte, las políticas RLS delimitan qué filas individuales puede consultar o modificar ese rol en función de condiciones de seguridad aplicables. Por tanto, la concesión de un permiso `SELECT` no constituye prueba suficiente de que una lectura esté efectivamente autorizada para un usuario.
- **Acceso efectivo:** El acceso real y seguro únicamente queda demostrado mediante peticiones efectivas en tiempo de ejecución utilizando sesiones y roles adecuados.
- **Alcance de los metadatos locales:** La consulta de metadatos en la instancia de PostgreSQL local confirma la configuración declarada en el entorno de desarrollo, pero no demuestra por sí sola que la aplicación se comporte correctamente durante la ejecución ni garantiza que otros entornos (como producción) compartan la misma configuración.

### A. Confirmado por inspección estática o metadatos locales
1. **Rutas reales del sistema:**
   - Inicio de sesión: `/ingresar` (`src/app/ingresar/page.tsx:1-6` y `signInAction`).
   - Registro de cuenta: `/crear-cuenta` (`src/app/crear-cuenta/page.tsx:1-6` y `signUpAction`).
   - Panel de administración: `/panel` y `/panel/actividad/[id]`.
   - Muro público: `/muro/[code]`, donde `code` corresponde al `public_code` alfanumérico de 8 caracteres generado para la actividad, no a su UUID.
2. **Permisos y RLS en base de datos local (`information_schema` y `pg_policies`):**
   - **`activities`:** El rol `anon` dispone de `SELECT` exclusivamente sobre 8 columnas (`id`, `public_code`, `title`, `question`, `status`, `created_at`, `opened_at`, `closed_at`). Las columnas `owner_id` y `moderation_mode` **no están concedidas** a `anon`.
   - **`ideas`:** El rol `anon` tiene `SELECT` concedido sobre 6 columnas (`id`, `activity_id`, `content`, `status`, `created_at`, `published_at`), restringido por RLS a ideas con `status = 'published'` en actividades abiertas o cerradas.
   - **`participants` e `idea_authors`:** El rol `anon` no dispone de ningún permiso (`REVOKE ALL`). El rol `authenticated` dispone únicamente de `SELECT`, sujeto a RLS por propiedad (`owner_id = auth.uid()`).
   - **Escrituras directas:** La inserción directa en `ideas`, `participants` e `idea_authors` está revocada a clientes; se canaliza exclusivamente por la función `submit_idea`. En `activities`, las escrituras directas de `authenticated` están sujetas a RLS con `owner_id = auth.uid()`.
   - **Habilitación de RLS:** Confirmado `relrowsecurity = true` en las 4 tablas del dominio (`activities`, `ideas`, `participants`, `idea_authors`) y 11 políticas activas.
3. **Configuración declarada de funciones y triggers:**
   - **`submit_idea`:** Configurada como `SECURITY DEFINER` (`prosecdef = true`), con aislamiento de esquema `search_path = ''` (`proconfig = {"search_path=\"\""}`), validaciones de longitud/formato y comprobación de actividad existente.
   - **`ideas_update_published_at`:** Trigger activo `before update of status on public.ideas`, gestionando automáticamente `published_at`. El código TypeScript no manipula dicho campo.
4. **Filtros de publicación en el muro público:**
   - La página inicial selecciona columnas explícitas de `activities` e `ideas`.
   - Tanto la consulta inicial como las consultas periódicas de `LiveWall` aplican `.eq("status", "published")`.
   - `owner_id` y los datos personales de participantes o autores no se incluyen en las consultas del muro.
   - El UUID interno de la actividad (`activity.id`) se pasa al componente cliente `LiveWall` para enlazar las consultas periódicas. El UUID no es un secreto; el control decisivo de seguridad reside en la autorización y las políticas RLS que restringen qué datos devuelve la consulta.

### B. Pendiente de validación funcional en tiempo de ejecución
1. **Autenticación real:** Inicio y cierre de sesión reales en navegador y persistencia observable de sesión sin asumir nombres fijos de cookies.
2. **Aislamiento multiusuario:** Comprobación con dos identidades independientes (Organizador A y Organizador B) de que B no puede acceder ni alterar recursos de A.
3. **Rechazo efectivo de lecturas y mutaciones:** Verificar mediante peticiones reales que RLS y las Server Actions bloqueen efectivamente intentos de consulta o modificación no autorizada, sin privilegios elevados.
4. **Comportamiento dinámico de `submit_idea`:** Probar el comportamiento de la función ante datos inválidos, actividad cerrada y solicitudes no autorizadas.
5. **Transiciones de estado y marcas temporales reales:** Verificar el comportamiento del trigger ante aprobación, rechazo, ocultamiento y republicación.
6. **Ausencia de fuga en datos serializados:** Confirmar empíricamente que ideas `pending` o `hidden` no aparezcan en el HTML inicial, los datos serializados de hidratación RSC ni en las respuestas de red.
7. **Adaptabilidad visual real:** Comprobación visual en navegador en resoluciones de escritorio (1280px+) y móvil (375px), verificando ausencia de desbordamientos y controles accesibles.

### C. Tabla de trazabilidad de fuentes de evidencia

| Aspecto técnico evaluado | Código fuente (TS/TSX) | Migraciones SQL | Metadatos PostgreSQL local | Pruebas funcionales en ejecución |
| :--- | :---: | :---: | :---: | :---: |
| Rutas `/ingresar`, `/crear-cuenta`, `/muro/[code]` | ✅ Confirmado | N/A | N/A | ⏳ Pendiente |
| Comprobaciones de `owner_id = user.id` en Server Actions | ✅ Confirmado | N/A | N/A | ⏳ Pendiente |
| Revocación de `owner_id` para `anon` en `activities` | N/A | ✅ Confirmado | ✅ Confirmado en BD local | ⏳ Pendiente |
| Políticas RLS activas en las 4 tablas | N/A | ✅ Confirmado | ✅ Confirmado en BD local | ⏳ Pendiente |
| Restricción de inserción directa en `ideas` | N/A | ✅ Confirmado | ✅ Confirmado en BD local | ⏳ Pendiente |
| `submit_idea` (`SECURITY DEFINER`, `search_path=''`) | N/A | ✅ Confirmado | ✅ Confirmado en BD local | ⏳ Pendiente |
| Trigger `published_at` en cambios de estado | ✅ Confirmado (no interfiere) | ✅ Confirmado | ✅ Confirmado en BD local | ⏳ Pendiente |
| Filtro `.eq("status", "published")` en el muro | ✅ Confirmado | N/A | N/A | ⏳ Pendiente |
| Ausencia de ideas no publicadas en HTML/serialización | ✅ Deducido en código | N/A | N/A | ⏳ Pendiente de validación dinámica |
| Aislamiento efectivo entre Organizador A y B | N/A | N/A | N/A | ⏳ Pendiente de ejecución |
| Adaptabilidad visual y ausencia de desbordamientos | N/A | N/A | N/A | ⏳ Pendiente de validación visual |

---

## 4. Matriz de pruebas de aceptación (12 casos)

### TC-01 — Inicio de sesión válido del organizador
- **Área:** Autenticación
- **Objetivo:** Confirmar que un organizador con credenciales legítimas puede autenticarse satisfactoriamente y acceder al panel de administración.
- **Precondiciones y datos de prueba:** Instancia local de Supabase activa (`127.0.0.1:25435`); cuenta de organizador ficticia registrada previamente en el entorno local (ej. `organizador_a@prueba.local`). *(Ruta de registro `/crear-cuenta` a verificar operativamente antes de la prueba)*.
- **Procedimiento propuesto:**
  1. Navegar a la ruta real `http://localhost:3000/ingresar`.
  2. Ingresar email y contraseña del organizador de prueba.
  3. Enviar el formulario de autenticación.
- **Resultado esperado y criterio de aceptación:** Redirección exitosa a `http://localhost:3000/panel`, persistencia observable de la sesión autenticada en el navegador y visualización de la interfaz del panel con el email del organizador.
- **Evidencia requerida:** URL final de aterrizaje, captura visual de `/panel` con sesión iniciada y comprobación de acceso autorizado sin depender de nombres de cookies asumidos.
- **Estado de inspección:** Compatible según inspección estática; pendiente de validación funcional
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

### TC-02 — Acceso a páginas y acciones privadas sin autenticación
- **Área:** Autorización
- **Objetivo:** Comprobar que un usuario no autenticado (anónimo) es rechazado al intentar ingresar a rutas protegidas o invocar Server Actions de administración.
- **Precondiciones y datos de prueba:** Navegador sin sesión activa (ventana en modo incógnito limpia).
- **Procedimiento propuesto:**
  1. Intentar acceder directamente por URL a `http://localhost:3000/panel`.
  2. Intentar acceder directamente a una ruta de detalle `http://localhost:3000/panel/actividad/[id-ficticio]`.
- **Resultado esperado y criterio de aceptación:** Redirección automática inmediata hacia `http://localhost:3000/ingresar`, sin renderizar vistas privadas ni exponer datos de actividades.
- **Evidencia requerida:** Redirección observada hacia `/ingresar` y ausencia de contenido privado en el cliente.
- **Estado de inspección:** Compatible según inspección estática; pendiente de validación funcional
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

### TC-03 — Propiedad de actividades y aislamiento entre organizadores
- **Área:** Autorización y Seguridad Multiusuario
- **Objetivo:** Verificar que un organizador autenticado no puede consultar, administrar, modificar ni eliminar actividades pertenecientes a otro organizador.
- **Precondiciones y datos de prueba:** Dos cuentas ficticias en Supabase local: Organizador A (`org_a@prueba.local`) y Organizador B (`org_b@prueba.local`). Actividad 1 creada por Organizador A.
- **Procedimiento propuesto:**
  1. Iniciar sesión como Organizador B.
  2. Verificar que la Actividad 1 no figura en el listado de `/panel` de B.
  3. Intentar acceder directamente por URL a `http://localhost:3000/panel/actividad/[id-actividad-1]`.
  4. Intentar ejecutar una Server Action (`moderateIdeaAction`, `setModerationModeAction`, `toggleActivityAction` o `deleteActivityAction`) sobre la Actividad 1 con la sesión de B.
- **Resultado esperado y criterio de aceptación:** La vista devuelve página `404` (no encontrada). Las Server Actions devuelven error de autorización o abortan la mutación por no coincidir `owner_id = user.id`. La base de datos no sufre modificación alguna.
- **Evidencia requerida:** Captura de la respuesta 404 en interfaz, respuesta de error devuelta por la Server Action y confirmación de integridad en base de datos.
- **Estado de inspección:** Compatible según inspección estática; pendiente de validación funcional
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

### TC-04 — Aprobar una idea pendiente en modo `approval`
- **Área:** Moderación de Ideas
- **Objetivo:** Confirmar que una idea en estado `pending` dentro de una actividad con moderación `approval` puede ser aprobada explícitamente y transicionar a `published`.
- **Precondiciones y datos de prueba:** Sesión iniciada como Organizador A; Actividad 1 configurada en modo `approval`; existencia de al menos una idea en estado `pending`.
- **Procedimiento propuesto:**
  1. Ingresar a `/panel/actividad/[id-actividad-1]`.
  2. Ubicar la idea en la sección de ideas pendientes.
  3. Hacer clic en el botón de acción explícita **«Aprobar idea»**.
- **Resultado esperado y criterio de aceptación:** La idea desaparece de la sección de pendientes y pasa a la lista de ideas publicadas. La base de datos actualiza `status = 'published'` y el trigger asigna `published_at = now()`.
- **Evidencia requerida:** Captura del panel tras la aprobación y comprobación del registro en base de datos (`status = 'published'`, `published_at IS NOT NULL`).
- **Estado de inspección:** Compatible según inspección estática; pendiente de validación funcional
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

### TC-05 — Publicar una idea pendiente en modo `automatic`
- **Área:** Moderación de Ideas
- **Objetivo:** Verificar la resolución explícita (corrección F1) de ideas que quedaron en estado `pending` tras alternar el modo de la actividad a `automatic`.
- **Precondiciones y datos de prueba:** Actividad con ideas pendientes previas cuyo modo fue cambiado a `automatic`.
- **Procedimiento propuesto:**
  1. Ingresar al panel de la actividad en modo automático.
  2. Localizar la idea pendiente con las acciones para resolverla.
  3. Hacer clic en el botón explícito **«Publicar idea»**.
- **Resultado esperado y criterio de aceptación:** La idea pasa satisfactoriamente a estado `published`, reflejándose de inmediato en la sección de ideas publicadas del panel. El servidor acepta la transición sin arrojar error.
- **Evidencia requerida:** Captura del panel con la idea publicada y verificación de estado en PostgreSQL.
- **Estado de inspección:** Compatible según inspección estática; pendiente de validación funcional
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

### TC-06 — Rechazar una idea pendiente en ambos modos
- **Área:** Moderación de Ideas
- **Objetivo:** Verificar que una idea en estado `pending` puede ser rechazada mediante la acción explícita «Rechazar idea» tanto en modo `approval` como en modo `automatic`.
- **Precondiciones y datos de prueba:** Actividad con al menos una idea en estado `pending`.
- **Procedimiento propuesto:**
  1. En el panel de administración de la actividad, ubicar la idea pendiente.
  2. Hacer clic en el botón de acción **«Rechazar idea»**.
- **Resultado esperado y criterio de aceptación:** La idea sale de la lista de pendientes y pasa a la sección de ideas ocultas/rechazadas (`status = 'hidden'`). El campo `published_at` permanece o se establece en `NULL`. La idea no se publica en el muro.
- **Evidencia requerida:** Captura del panel mostrando la idea en la pestaña/lista de ocultas y verificación de `status = 'hidden'` en base de datos.
- **Estado de inspección:** Compatible según inspección estática; pendiente de validación funcional
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

### TC-07 — Ocultar una idea publicada
- **Área:** Moderación de Ideas
- **Objetivo:** Confirmar que una idea visible en el muro (`published`) puede ser retirada por el organizador en cualquier momento mediante el botón «Ocultar del muro».
- **Precondiciones y datos de prueba:** Actividad con al menos una idea en estado `published`.
- **Procedimiento propuesto:**
  1. En `/panel/actividad/[id]`, ubicar la idea en la lista de publicadas.
  2. Hacer clic en **«Ocultar del muro»**.
- **Resultado esperado y criterio de aceptación:** La idea cambia su estado a `hidden`, desaparece de la vista pública del muro y pasa a la sección de ideas ocultas del panel.
- **Evidencia requerida:** Captura del panel tras la acción y consulta del estado en la tabla `ideas` (`status = 'hidden'`, `published_at IS NULL`).
- **Estado de inspección:** Compatible según inspección estática; pendiente de validación funcional
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

### TC-08 — Volver a publicar una idea oculta
- **Área:** Moderación de Ideas
- **Objetivo:** Verificar que una idea que se encuentra en estado `hidden` puede ser restaurada al muro público mediante el botón «Volver a mostrar en el muro».
- **Precondiciones y datos de prueba:** Actividad con al menos una idea en estado `hidden`.
- **Procedimiento propuesto:**
  1. En `/panel/actividad/[id]`, ubicar la idea en la sección de ideas ocultas.
  2. Hacer clic en **«Volver a mostrar en el muro»**.
- **Resultado esperado y criterio de aceptación:** La idea pasa a estado `published`, reaparece en la lista de publicadas del panel y vuelve a ser legible en el muro público con una nueva marca temporal de publicación.
- **Evidencia requerida:** Captura del panel y comprobación de visibilidad en el muro y en base de datos.
- **Estado de inspección:** Compatible según inspección estática; pendiente de validación funcional
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

### TC-09 — Verificar persistencia y trigger de `published_at`
- **Área:** Persistencia y Base de Datos
- **Objetivo:** Validar funcionalmente que el trigger de PostgreSQL `ideas_update_published_at` opera como la única fuente de verdad y asigna correctamente las marcas de tiempo en todo el ciclo de vida de la idea, incluida la republicación.
- **Precondiciones y datos de prueba:** Ejecución secuencial de moderación sobre una misma idea (creación -> publicación -> ocultamiento -> republicación).
- **Procedimiento propuesto:**
  1. Consultar en base de datos la fila de la idea tras cada transición de estado:
     - Estado inicial `pending`: comprobar `published_at IS NULL`.
     - Transición a `published`: comprobar que `published_at` adquiere una marca temporal válida.
     - Transición a `hidden`: comprobar que `published_at` queda en `NULL`.
     - Retorno a `published` (republicación): comprobar que se genera una nueva marca de publicación conforme al comportamiento real del trigger.
- **Resultado esperado y criterio de aceptación:** Las asignaciones temporales son ejecutadas exclusivamente por el trigger SQL sin interferencias del código TypeScript:
  - Al publicar, `published_at` adquiere una marca temporal válida.
  - Al ocultar o rechazar, `published_at` queda en `NULL`.
  - Al republicar, se genera una nueva marca de publicación conforme al comportamiento real del trigger.
  - Si la resolución temporal impide distinguir dos valores consecutivos (por ejemplo, transiciones inmediatas dentro del mismo segundo o tick de reloj), se registra esa limitación técnica y no se declara un fallo únicamente por la igualdad de las marcas.
- **Evidencia requerida:** Registro de consultas SQL / visualización en Supabase Studio de la fila en la tabla `public.ideas`.
- **Estado de inspección:** Compatible según inspección estática; pendiente de validación funcional
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

### TC-10 — Verificar las políticas RLS con roles y sesiones adecuados
- **Área:** Seguridad y RLS en Base de Datos
- **Objetivo:** Comprobar que las políticas de seguridad a nivel de fila (RLS) en `public.ideas`, `public.activities`, `public.participants` e `public.idea_authors` operan efectivamente para peticiones con credenciales de usuario real (`authenticated`) y de usuario anónimo (`anon`), distinguiendo permisos de lectura y de mutación sin privilegios de superusuario.
- **Precondiciones y datos de prueba:** Dos identidades confirmadas como distintas en Supabase local: Organizador A (`org_a@prueba.local`, propietario) y Organizador B (`org_b@prueba.local`, ajeno), además de cliente anónimo sin sesión. Existencia previamente confirmada de un recurso de prueba propiedad de A (actividad e idea asociada).
- **Procedimiento propuesto:**
  1. Confirmar que las cuentas A y B son identidades distintas y que la sesión de prueba corresponde inequívocamente a B.
  2. Confirmar previamente la existencia del recurso de prueba propiedad de A mediante un método de verificación autorizado.
  3. Desde la sesión anónima, consultar `public.ideas`: verificar que solo retorna filas con `status = 'published'` de actividades abiertas o cerradas.
  4. Desde la sesión anónima, intentar consultar `public.participants` o `public.idea_authors`: verificar que el acceso no retorna datos ajenos ni viola RLS.
  5. Desde la sesión de Organizador B, intentar la lectura y las mutaciones (actualizar o eliminar sobre la actividad o idea de A) utilizando exclusivamente las credenciales normales de B, sin `service_role`, sin superusuario ni privilegios elevados.
  6. Registrar detalladamente las respuestas obtenidas (códigos HTTP, respuestas de API/PostgREST o errores SQL).
  7. Comprobar, mediante un método de verificación independiente y autorizado (ej. consulta administrativa de control de solo lectura), que el recurso de A no sufrió cambio alguno.
- **Resultado esperado y criterio de aceptación:** Aislamiento total en capa de base de datos garantizado por RLS, comprobado mediante sesiones reales independientes. Se exige distinguir conceptualmente entre:
  - Acceso denegado (error de autorización o violación de permisos).
  - Cero filas afectadas (filtrado transparente por RLS sin error explícito).
  - Éxito aparente (código de respuesta exitoso que no produjo mutación real).
  Ninguno de esos resultados debe interpretarse aisladamente como prueba concluyente de seguridad sin contrastar con la verificación independiente de que el recurso de A no cambió.
- **Evidencia requerida:** Respuestas de consultas de red con tokens JWT de prueba normales de B, respuestas de PostgREST y verificación independiente del estado inalterado del recurso de A.
- **Estado de inspección:** Compatible según inspección estática; pendiente de validación funcional (la ejecución de estos pasos sigue pendiente de autorización expresa).
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

### TC-11 — Visualización del muro público con ideas autorizadas
- **Área:** Muro Público
- **Objetivo:** Comprobar que la ruta pública real `/muro/[code]` (donde `code` es el `public_code` alfanumérico) presenta exclusivamente las ideas autorizadas y publicadas, omitiendo contenido pendiente u oculto tanto en la interfaz como en el HTML y datos serializados transferidos al cliente.
- **Precondiciones y datos de prueba:** Actividad abierta con código público conocido y un conjunto heterogéneo de ideas: al menos 1 `published`, 1 `pending` y 1 `hidden`.
- **Procedimiento propuesto:**
  1. Acceder como visitante anónimo a la URL pública `http://localhost:3000/muro/[code]`.
  2. Inspeccionar visualmente las tarjetas de ideas renderizadas.
  3. Inspeccionar el código fuente HTML, los datos serializados del cliente y las respuestas de red.
- **Resultado esperado y criterio de aceptación:** El muro despliega únicamente las ideas con `status = 'published'`. Ninguna idea `pending` ni `hidden` aparece en pantalla, ni está presente en los payloads serializados del cliente.
- **Evidencia requerida:** Captura visual del muro público e inspección del payload/DOM del navegador.
- **Estado de inspección:** Compatible según inspección estática; pendiente de validación funcional
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

### TC-12 — Revisión de la interfaz en escritorio y móvil
- **Área:** Diseño Adaptable y Accesibilidad
- **Objetivo:** Validar visualmente que las pantallas de administración (`/panel` y `/panel/actividad/[id]`) y el muro público se visualizan de manera armónica, sin desbordamientos de texto ni elementos inaccesibles en pantallas amplias y reducidas.
- **Precondiciones y datos de prueba:** Sesión iniciada en el panel de actividad y visualización del muro con datos cargados.
- **Procedimiento propuesto:**
  1. Evaluar las vistas en resolución de escritorio (viewport estándar de 1280 × 800 px o superior).
  2. Evaluar las vistas en resolución móvil (viewport estándar de 375 × 667 px o 390 × 844 px).
  3. Probar la apertura del modal de confirmación de eliminación de actividad (`DeleteActivityButton`) y verificar la presencia del término «actividad».
- **Resultado esperado y criterio de aceptación:** La interfaz no presenta barras de desplazamiento horizontal indeseadas; los botones de moderación mantienen espaciado táctil y jerarquía clara; los textos de estado son legibles; el modal de confirmación está centrado y utiliza exclusivamente el término «actividad».
- **Evidencia requerida:** Capturas de pantalla comparativas en vista de escritorio y en vista móvil.
- **Estado de inspección:** Pendiente de validación visual real
- **Resultado real:** Sin ejecutar
- **Observaciones / Defectos:** Por completar durante la ejecución.

---

## 5. Criterios de aceptación transversales

Para declarar superada la verificación funcional de la administración, deben cumplirse simultáneamente los siguientes criterios globales:
1. **Protección de rutas privadas:** Un usuario no autenticado no puede acceder a ninguna vista ni acción privada de administración bajo ninguna circunstancia, siendo redirigido invariablemente a `/ingresar`.
2. **Aislamiento multiusuario estricto:** Un organizador no puede leer, listar, modificar ni eliminar actividades, participantes ni ideas de otro organizador.
3. **Coherencia en transiciones de moderación:** Las transiciones de estado de una idea obedecen estrictamente a la matriz aprobada:
   - `pending` -> `published` (aprobación / publicación).
   - `pending` -> `hidden` (rechazo).
   - `published` -> `hidden` (ocultamiento).
   - `hidden` -> `published` (republicación).
4. **Privacidad del muro:** Las ideas en estado `pending` o `hidden` jamás son visibles en la interfaz pública ni expuestas en las consultas, HTML o datos serializados del muro.
5. **Sincronización de visibilidad:** Cualquier cambio de estado realizado desde el panel se refleja en la base de datos y en la consulta periódica del muro.
6. **Integridad de marcas de tiempo en base de datos:** El campo `published_at` es gestionado inequívocamente por el trigger `ideas_update_published_at`, asignando una marca temporal válida al publicarse, `NULL` al ocultarse o rechazarse, y una nueva marca conforme al trigger al republicarse (registrando cualquier limitación si la resolución temporal del entorno coincide en el mismo instante).
7. **Validación real de permisos y RLS:** Los permisos SQL determinan qué operaciones y columnas puede solicitar un rol, mientras que las políticas RLS determinan qué filas específicas son accesibles; la concesión de `SELECT` no es prueba suficiente de que una lectura esté autorizada. El acceso efectivo debe verificarse mediante sesiones reales independientes (sin `service_role` ni privilegios elevados), distinguiendo entre acceso denegado, cero filas afectadas y éxito aparente, y comprobando independientemente que los recursos protegidos permanezcan inalterados.
8. **Calidad de interfaz y adaptabilidad:** La interfaz no debe presentar desbordamientos horizontales, solapamiento de componentes ni botones inhabilitados incorrectamente en viewports móviles o de escritorio.

*(Regla de gobernanza: Si durante la ejecución de las pruebas se detecta alguna discrepancia entre el comportamiento observado y el modelo de datos o el código, se registrará como observación o hallazgo a verificar, sin alterar la implementación funcional sin autorización).*

---

## 6. Entorno, datos y seguridad

### 6.1 Restricción de entorno
- Todas las pruebas deben ejecutarse **exclusivamente contra el entorno local**:
  - Aplicación: `http://localhost:3000`
  - API y Auth: `http://127.0.0.1:25435`
  - Base de datos PostgreSQL: `127.0.0.1:25433`
  - Supabase Studio: `http://127.0.0.1:25434`
- Antes de iniciar cualquier prueba, se debe revalidar que la variable `NEXT_PUBLIC_SUPABASE_URL` apunta a la dirección local `127.0.0.1:25435`. **Si no es posible demostrar de forma concluyente que el entorno es local, la ejecución debe detenerse de inmediato.**

### 6.2 Datos de prueba
- Deben crearse y utilizarse únicamente cuentas de usuario y actividades ficticias destinadas a testing (ej. `organizador_a@prueba.local`, `organizador_b@prueba.local`).
- Queda terminantemente prohibido utilizar cuentas personales, credenciales reales o actividades productivas para la realización de pruebas.
- Ninguna prueba destructiva (eliminación de actividades) se ejecutará sobre datos que no hayan sido creados específicamente dentro de la sesión de prueba.

### 6.3 Manejo de información sensible
- Ninguna contraseña, token JWT de sesión, clave de API ni cookie debe quedar registrada de forma visible en esta ficha ni en los informes de avance.
- Las capturas y evidencias deberán centrarse en los elementos de interfaz, códigos de estado y respuestas funcionales.

---

## 7. Verificaciones de seguridad y RLS pendientes de ejecución técnica

La inspección de permisos SQL, políticas RLS y metadatos no equivale a una prueba de seguridad sobre la base de datos activa. Los permisos SQL determinan qué operaciones y columnas puede solicitar cada rol, las políticas RLS determinan qué filas puede consultar o modificar según las condiciones aplicables, y la concesión de `SELECT` no es prueba suficiente de que una lectura esté autorizada. Los metadatos de PostgreSQL local no demuestran por sí solos un comportamiento correcto en ejecución ni que producción disponga de la misma configuración. El acceso efectivo debe comprobarse mediante peticiones reales con sesiones y roles adecuados.

Permanecen documentadas como pendientes las siguientes comprobaciones:
1. **Confirmación de permisos efectivos en runtime:** Determinar empíricamente mediante peticiones cliente que el rol `anon` sea rechazado si intenta proyectar columnas no concedidas como `owner_id`.
2. **Exposición en consulta pública:** Verificar que la consulta pública `/muro/[code]` no exponga campos internos (`owner_id`) ni datos privados en la respuesta de red ni en el HTML del servidor.
3. **Restricciones con sesiones reales independientes:** Comprobar el aislamiento utilizando tres contextos independientes: Organizador A (propietario), Organizador B (ajeno) y visitante anónimo.
4. **Verificación de mutaciones no autorizadas:** Intentar modificaciones directas sin privilegios elevados para confirmar que RLS y las Server Actions rechazan la escritura.
5. **Inspección de datos serializados:** Confirmar que las ideas `pending` y `hidden` no aparezcan en el HTML ni en los datos serializados transferidos al cliente.
6. **Comprobación de la RPC `submit_idea`:** Verificar en tiempo de ejecución sus validaciones ante entradas inválidas, actividad cerrada y solicitudes no autorizadas.

---

## 8. Riesgos y bloqueos identificados

1. **Inexistencia de suite de testing automatizada:** El repositorio no cuenta con dependencias como Vitest, Playwright o Cypress. La ejecución de las pruebas deberá llevarse a cabo mediante inspección interactiva y comprobaciones manuales/asistidas.
2. **Ausencia de datos semilla (*seed data*):** La base de datos local no cuenta con registros precargados de actividades ni ideas. Se requiere la preparación previa de datos ficticios para poder ejecutar los casos TC-01 a TC-12.
3. **Requisito de múltiples identidades para pruebas de seguridad:** La comprobación efectiva de TC-03 y TC-10 depende de registrar al menos dos cuentas de organizador distintas en Supabase local.
4. **Validación de entorno real pendiente:** Tal como se documentó al cierre de la Etapa 2, no se habían ejecutado hasta ahora pruebas de extremo a extremo contra la base de datos local activa.
5. **Necesidad de herramientas de captura para pruebas visuales:** TC-12 requerirá capturas de pantalla tanto en resolución amplia como reducida para evidenciar el comportamiento responsivo.

---

## 9. Secuencia propuesta y registro de aceptación

La ejecución de la matriz se organizará de forma metódica en cuatro bloques consecutivos:

```
[Bloque 1: Acceso y Seguridad] (TC-01, TC-02, TC-03)
         ↓
[Bloque 2: Moderación de Ideas] (TC-04, TC-05, TC-06, TC-07, TC-08)
         ↓
[Bloque 3: Persistencia y RLS] (TC-09, TC-10)
         ↓
[Bloque 4: Muro Público y Revisión Visual] (TC-11, TC-12)
```

### Tabla de registro de ejecución (Para completar durante la etapa)

| Bloque | Caso | Fecha de ejecución | Responsable | Evidencia adjunta | Resultado (Pasa / Falla) | Defectos asociados |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Acceso y Seguridad** | TC-01 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |
| | TC-02 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |
| | TC-03 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |
| **2. Moderación** | TC-04 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |
| | TC-05 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |
| | TC-06 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |
| | TC-07 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |
| | TC-08 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |
| **3. Persistencia y RLS** | TC-09 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |
| | TC-10 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |
| **4. Muro y Visual** | TC-11 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |
| | TC-12 | *Pendiente* | *Por asignar* | *Pendiente* | *Sin ejecutar* | — |

---

## 10. Estado documental

- **Carácter del documento:** Plan de pruebas y matriz de aceptación formal. No constituye un informe de resultados ejecutados.
- **Estado formal:** `Plan documentado; ejecución pendiente`.
- **Cierre de fase de preparación:** La ejecución efectiva de los bloques de prueba queda condicionada a la revisión y autorización expresa del responsable del proyecto. No se declara la aplicación lista para producción ni para despliegue.
