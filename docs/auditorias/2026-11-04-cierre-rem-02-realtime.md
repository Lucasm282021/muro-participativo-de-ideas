# Informe de cierre — Remediación REM-02 (Diagnóstico de Supabase Realtime y filtrado de eventos)

**Fecha:** 2026-11-04 · **Entorno:** Local / Repositorio Git · **Alcance:** Diagnóstico arquitectónico y de seguridad de Realtime · **Documento rector:** `puntos_fundamentales_desarrollo_software.md`

> **Estado:** La remediación **REM-02** queda **cerrada a nivel documental con clasificación PARCIALMENTE CONFIRMADO y dictamen de NO INTERVENCIÓN INMEDIATA**. La implementación actual que realiza la discriminación de actividad en el cliente (`if (idea.activity_id !== currentActivityId) return;`) se conserva intacta por razones de estabilidad operativa, resiliencia funcional y prevención de regresiones críticas en la entrega de eventos en tiempo real.

---

## 1. Objetivo del Diagnóstico

Auditar de forma integral y en modo de solo lectura el funcionamiento de Supabase Realtime en el proyecto Muro Participativo de Ideas a partir del hallazgo REM-02, el cual cuestionaba si la suscripción a eventos en `live-wall.tsx` sin filtro de servidor generaba tráfico innecesario, si admitía optimización mediante Postgres Changes y si existían restricciones funcionales o de seguridad que justificaran o desaconsejaran una modificación.

---

## 2. Estado Actual de las Suscripciones y Mecanismos de Reconciliación

La inspección estática del código fuente identificó exactamente dos componentes que establecen canales de Supabase Realtime en toda la aplicación, presentando arquitecturas de sincronización diferenciadas:

1. **Muro público (`src/components/live-wall.tsx`):**
   - Canal: `ideas:${activityId}`.
   - Escucha: `postgres_changes` con `event: "*"`, esquema `public`, tabla `ideas`, sin parámetro `filter`.
   - Limpieza: Invocación de `supabase.removeChannel(channel)` y cancelación del intervalo en el retorno de `useEffect`.
   - **Mecanismos de reconciliación asociados (exclusivos de este componente):**
     Para mitigar la eventual pérdida de eventos por desconexión o latencia, este componente incorpora tres mecanismos complementarios:
     1. *Reconciliación al conectar:* disparo de `requestReconcile()` inmediatamente al alcanzar el estado `SUBSCRIBED`.
     2. *Reconciliación periódica:* ciclo de consulta de delta cada 10 segundos (`setInterval` con `RESYNC_INTERVAL_MS`).
     3. *Reconciliación al recuperar visibilidad:* listener sobre el evento `visibilitychange` de la ventana (`document.visibilityState === "visible"`).
2. **Refresco del panel de administración (`src/app/panel/actividad/[id]/panel-live-refresh.tsx`):**
   - Canal: `panel:ideas:${activityId}`.
   - Escucha: `postgres_changes` con `event: "*"`, esquema `public`, tabla `ideas`, sin parámetro `filter`.
   - Limpieza: Invocación de `supabase.removeChannel(channel)` y cancelación de temporizador en el retorno de `useEffect`.
   - **Mecanismo de refresco:** A diferencia del muro, este componente **no cuenta con el triple mecanismo de reconciliación periódica ni por visibilidad**. Su diseño es puramente reactivo ante eventos recibidos, aplicando un debounce de 400 ms que invoca a `router.refresh()` de Next.js si el `targetActivityId` coincide con la actividad administrada.

---

## 3. Antecedente Histórico en el Repositorio

La ausencia de filtro en el servidor no es una omisión inadvertida, sino una decisión defensiva previa documentada en el historial de Git:

- **Commit `d47878bc` (02/10/2026):** La implementación inicial del MVP incorporaba formalmente el filtro `filter: activity_id=eq.${activityId}`.
- **Commit `5f02366e` (16/10/2026):** Titulado *"fix: restaurar eventos realtime del muro"*, eliminó el filtro de servidor en `live-wall.tsx`.
- **Commit `0d706e38` (16/10/2026):** Registró en `docs/estado-actual-del-producto.md` (§8.2) la evidencia observada:
  > *"Se detectó que el filtro servidor por `activity_id` no entregaba eventos en el stack local; la suscripción quedó sin ese filtro y conserva la comprobación estricta de actividad en cliente. La actualización se observó en menos de 2 s."*

Esta evidencia histórica demuestra que, en la configuración del entorno de desarrollo local evaluado en esa fecha, la imposición del filtro por columna causaba la pérdida de entrega de eventos, motivando su retiro para restaurar la operatividad en tiempo real. Este comportamiento se registra como un hecho empírico de dicho entorno, sin extrapolarlo como una falla intrínseca de todas las versiones o infraestructuras gestionadas de Supabase.

---

## 4. Funcionamiento del Filtrado en Cliente

En ambos componentes receptores, la discriminación de pertenencia se realiza de forma inmediata al recibir el mensaje por WebSocket:

- En `live-wall.tsx`:
  ```typescript
  if (idea.activity_id !== currentActivityId) {
    return;
  }
  ```
- En `panel-live-refresh.tsx`:
  ```typescript
  const targetActivityId = newRecord?.activity_id ?? oldRecord?.activity_id;
  if (targetActivityId !== activityId) {
    return;
  }
  ```

**Características técnicas del descarte en cliente:**
- Se ejecuta en la primera instrucción del handler antes de cualquier procesamiento posterior.
- Complejidad $O(1)$ basada en comparación directa de cadenas.
- No dispara actualizaciones de estado en React (`useState`/`useReducer`), no invoca reconciliación del DOM virtual ni altera la interfaz de usuario.

---

## 5. Alcance Real de la Seguridad e Interacción con RLS

El análisis de seguridad del flujo Realtime distingue estrictamente entre lo confirmado analíticamente y lo validado dinámicamente:

### 5.1. Confirmado mediante inspección estática (Esquema y políticas)
Según la migración `supabase/migrations/20261002080804_initial_data_model.sql`:
- La tabla `public.ideas` tiene RLS habilitado y está en la publicación `supabase_realtime` con `REPLICA IDENTITY FULL`.
- El rol `anon` solo tiene permiso `SELECT` concedido sobre las columnas: `(id, activity_id, content, status, created_at, published_at)`.
- La política de lectura pública restringe:
  `status = 'published' AND EXISTS (SELECT 1 FROM activities WHERE id = ideas.activity_id AND status IN ('open', 'closed'))`.
- Estructuralmente, la tabla `ideas` no contiene columnas de autor, correo o identidad de participantes. El vínculo de autoría reside en `public.idea_authors`, tabla no publicada en Realtime y con lectura restringida exclusivamente al organizador autenticado.
- Bajo el modelo formal de Supabase Realtime, el motor evalúa las políticas RLS antes de emitir un evento a clientes anónimos.

### 5.2. Confirmado mediante pruebas dinámicas previas
- En las pruebas locales registradas el 16/10/2026 (`docs/estado-actual-del-producto.md` §8.2), se constató dinámicamente que ideas en estado `pending` no aparecieron en el cliente público del muro y requirieron moderación a `published` para ingresar a la vista.

### 5.3. Pendiente de validación empírica
- No se ha realizado una captura directa ni análisis de paquetes del tráfico WebSocket de Realtime para verificar de forma independiente si el motor Postgres Changes de Supabase filtra en todos los casos las filas no conformes con la subconsulta de RLS en entornos productivos.
- Por tanto, la protección se afirma en función de las reglas declaradas en el catálogo de PostgreSQL y la documentación oficial del motor, reconociendo que no existe una prueba de penetración dinámica de red ejecutada durante esta auditoría.

---

## 6. Estimación de Impacto sobre el Tráfico

Al no existir instrumentación de telemetría de red desplegada en producción, el impacto se presenta como una **estimación analítica teórica**, no como una medición empírica:

- **Tamaño del payload estimado:** Un evento `INSERT` o `UPDATE` de `ideas` serializado en JSON representa aproximadamente entre 350 y 500 bytes.
- **Escenario mono-actividad:** Tráfico innecesario nulo ($0$ bytes descartados), ya que todos los eventos corresponden a la actividad activa.
- **Escenario multiactividad concurrente:** En caso de coexistir varias actividades públicas recibiendo ideas en simultáneo, los clientes del muro $A$ recibirían los eventos de ideas publicadas en el muro $B$, descartándolos en memoria.
- **Evaluación de magnitud:** Para la escala de uso prevista en el MVP (eventos moderados con concurrencia acotada), el tráfico derivado de descartes se estima en el orden de kilobytes por hora, resultando insignificante frente a la carga de assets estáticos de la aplicación. No se identifica un problema inmediato de saturación de ancho de banda.

---

## 7. Riesgos de Regresión Funcional

Reintroducir precipitadamente un filtro en servidor implica riesgos funcionales severos comprobados:

1. **Riesgo de cese de eventos en tiempo real:** Reincidencia del fallo documentado el 16/10/2026, donde el canal dejaba de emitir eventos hacia el cliente en determinados entornos.
2. **Riesgo en eventos de moderación (`UPDATE` a `hidden`):** El muro público requiere recibir eventos cuando un organizador modera una idea de `published` a `hidden` para retirarla de la pantalla (`handleRemoveIdea(idea.id)`). Si se introdujeran filtros mal calibrados (por ejemplo, filtrando por estado en servidor), el cliente no recibiría el evento `UPDATE`, dejando ideas censuradas visibles en el muro.
3. **Riesgo en eventos de eliminación (`DELETE`):** Aunque existe `REPLICA IDENTITY FULL`, el filtrado de eventos de borrado por columnas secundarias en logical replication puede presentar comportamientos dispares entre versiones del motor.

---

## 8. Alternativas Evaluadas

1. **Alternativa 1 — Estado Actual (Defensivo / Conservador):**
   - Suscripción a `ideas` con filtrado estricto en cliente.
   - Respaldada en el muro público por los tres mecanismos de reconciliación (al conectar, periódico y en foco).
   - Decisión: **Recomendada y conservada para el MVP.**
2. **Alternativa 2 — Reincorporación de `filter: activity_id=eq.${activityId}`:**
   - Supresión de tráfico cruzado en servidor.
   - Descartada por riesgo inmediato de regresión sin validación previa en laboratorio.
3. **Alternativa 3 — Canales Broadcast / Mensajería Dedicada:**
   - Emisión de eventos vía WebSockets sobre canales efímeros específicos sin replicación lógica de Postgres.
   - Evaluada solo a nivel conceptual; no se considera necesaria ni aprobada para la etapa MVP, dado el costo de reingeniería sobre Server Actions y base de datos.

---

## 9. Recomendación Técnica y Clasificación

### Clasificación: **PARCIALMENTE CONFIRMADO**

- **Justificación:** Se confirma la existencia de una oportunidad teórica de optimización de red para cuando la plataforma escale a decenas de actividades simultáneas de alto tráfico. No obstante, no se comprueba que el comportamiento actual constituya un defecto o anomalía que degrade la operación del sistema en su estado actual.
- **Decisión técnica:** **Sin intervención inmediata sobre el código.** La prioridad técnica es salvaguardar la estabilidad de la presentación en vivo.
- **Asignación en roadmap:** Se clasifica como ítem de **P2 (Escalabilidad y Mejoras)**. Conservar la implementación actual es una decisión operativa para el MVP, no una garantía de escalabilidad indefinida ante cargas masivas.

---

## 10. Pruebas Realizadas y Limitaciones

- **Pruebas realizadas:**
  - Inspección estática de [src/components/live-wall.tsx](file:///C:/Users/lucas/Desktop/Proyectos%20de%202026/muro-docs-rem02/src/components/live-wall.tsx) y [src/app/panel/actividad/[id]/panel-live-refresh.tsx](file:///C:/Users/lucas/Desktop/Proyectos%20de%202026/muro-docs-rem02/src/app/panel/actividad/[id]/panel-live-refresh.tsx).
  - Análisis de trazabilidad en el grafo de Git (`git log -S "filter"`).
  - Auditoría de esquema relacional y políticas RLS en `supabase/migrations/20261002080804_initial_data_model.sql`.
- **Limitaciones expresas:**
  - **No se realizaron pruebas de carga** ni mediciones empíricas de ancho de banda o latencia.
  - No se reactivó la prueba dinámica `tests/submit-idea-dynamic.test.mjs` (permanece `BLOCKED` por credenciales locales no aprovisionadas).
  - No se validaron dinámicamente todos los posibles escenarios de carrera entre `UPDATE` y `DELETE` concurrentes bajo WebSocket.

---

## 11. Aspectos Pendientes de Validación para Futuras Fases

Cualquier reconsideración futura de este diseño requerirá:
1. Ensayos controlados en Supabase Cloud con dos o más actividades públicas abiertas concurrentemente recibiendo envíos continuos.
2. Comprobación empírica de que `filter: activity_id=eq.${activityId}` entregue sin excepciones eventos `INSERT`, `UPDATE` (incluyendo transición a `hidden`) y `DELETE`.
3. Verificación de consumo de recursos y límites de cuota de mensajes en el dashboard de Supabase bajo carga simulada.

---

## 12. Dictamen Final

### **APTO — CIERRE DOCUMENTAL SIN MODIFICACIÓN DE CÓDIGO**

Se dictamina que el diseño actual de Supabase Realtime es seguro, resiliente y adecuado para el producto. El hallazgo REM-02 queda formalmente documentado y cerrado sin cambios en el código de la aplicación.
