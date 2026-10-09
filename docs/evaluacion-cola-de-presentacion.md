# Evaluación arquitectónica: modelo de presentación y cola de ideas

**Fecha:** 08/10/2026
**Estado:** Propuesta arquitectónica evaluable (no implementada)
**Entradas:** Documento funcional *Modelo de presentación y cola de ideas* + evidencia de la Fase 2 (AUD-002/003/004/005/006/007)
**Alcance:** Evaluación y roadmap. No define implementación concreta, ni cambia código, base de datos, configuración ni dependencias.

> **Nombre del archivo:** `docs/` contiene hoy tres documentos planos en español (`arquitectura.md`, `modelo-de-datos.md`, `despliegue.md`). Se propone `docs/evaluacion-cola-de-presentacion.md` para mantener esa convención en lugar de `docs/architecture/presentation-queue-evaluation.md`.

---

## 1. Resumen ejecutivo

El nuevo modelo funcional **no exige nueva infraestructura**. Sustituye el render directo de ideas por una máquina de estados en el cliente del muro: **cola FIFO → idea destacada → transición → muro acotado**. Todo el estado de presentación puede vivir **localmente** en la pantalla que proyecta; la base de datos sigue siendo la única fuente de verdad de las ideas.

Las cuatro evidencias de Fase 2 que condicionan el diseño son:

| Evidencia | Efecto sobre el nuevo modelo |
| --- | --- |
| **AUD-002**: PostgREST trunca en 1000 filas y el muro no limita | El muro ya **no debe** cargar todo: con muro acotado a N tarjetas, la query pasa a `.limit(N)` y el límite de 1000 deja de ser relevante para el muro. **[HECHO]** |
| **AUD-003**: sin resync, eventos perdidos durante desconexión | La cola local pierde ideas si nadie las reconsulta: hace falta **un delta refetch** al reconectar (P1). **[HECHO]** |
| **AUD-004**: RLS filtra `UPDATE` y no `DELETE` | Una idea **ocultada no emite evento**: puede quedar en cola o en el muro hasta el próximo refetch (P1). **[HECHO documental]** |
| **AUD-005**: RPC `submit_idea` sin rate limit y con ideas ilimitadas por email | La cola **amplifica** el abuso: spam = presentations en el proyector. El control de frecuencia pasa a ser previo al MVP de presentación (P1). **[HECHO]** |

Conclusión central: **la cola local es suficiente para el MVP** (un proyector canónico), y la cola compartida entre pantallas sólo se justifica si el producto decide que varias pantallas deben presentar sincronizadas (P2, con cursor persistido).

---

## 2. Modelo actual frente al nuevo modelo funcional

### 2.1 Qué partes ya soportan el nuevo modelo

| Capacidad actual | Evidencia | Estado |
| --- | --- | --- |
| Toda idea publicada se conserva en la DB | Tabla `ideas` sin borrado automático; histórico = DB | **[HECHO]** |
| Detección de ideas nuevas sin refrescar | `live-wall.tsx:26-60` suscribe `postgres_changes` con `event: "*"` y filtro `activity_id` | **[HECHO]** |
| Sin duplicados | El handler filtra por `id` antes de prepend (`live-wall.tsx:47-52`): operación idempotente | **[HECHO]** |
| Orden disponible para FIFO | Payload realtime incluye `created_at` y `published_at` (ambos en los grants anon, migración `:152-153`) | **[HECHO]** |
| Índice para carga inicial acotada | `ideas_activity_status_created_at_idx (activity_id, status, created_at desc)` (`:56-57`) | **[HECHO]** |
| Sólo ideas publicadas llegan al cliente público | RLS exige `status='published'`; INSERT de `pending` no emite evento | **[HECHO]** |
| `published_at` mantenido por trigger | `ideas_update_published_at` (`:296-298`) lo pone/limpia/conserva en cada UPDATE | **[HECHO]** |
| Estado de la idea es un enum de 3 valores | `pending | published | hidden` (`:6`) | **[HECHO]** |

### 2.2 Qué partes deben modificarse (sólo cliente del muro)

1. `LiveWall` hoy hace `setIdeas(nueva idea)` directo al grid → debe pasar por **cola → destacada → muro**.
2. Identidad visual por índice (`idea-card-${index % 5}`, `live-wall.tsx:91`) → debe derivarse de un valor **estable por idea**.
3. Query sin `.limit()` (`muro/[code]/page.tsx:20-24`) → `.limit(N)` + retener últimas N en estado.
4. `.subscribe()` sin callback (`live-wall.tsx:55`) → manejo de estado de canal (P1).
5. Sin resync → delta refetch (P1).

### 2.3 Qué partes deben mantenerse intactas

- Esquema de tablas, enums, triggers e índices (**sin nuevas tablas**).
- RLS y grants.
- RPC `submit_idea` y flujo de moderación existente (el control de spam es un cambio *dentro* de la RPC, no un sistema nuevo).
- Server Actions, autenticación, panel (salvo los puntos P1/P3 señalados).
- Supabase Realtime como mecanismo de aviso (ya cumple el rol "no fuente de verdad" que pide el modelo).

### 2.4 ¿La cola puede ser completamente local al cliente?

**Sí, para el MVP.** **[DECISIÓN ARQUITECTÓNICA]**

Justificación por evidencia, no por robustez teórica:

- La cola controla **presentación**, no **datos**: todo lo que la cola contiene ya está persistido y es recuperable desde la DB.
- El estado compartido que una cola remota compraría (cursor de "última presentada") sólo importa si hay más de una pantalla sincronizada. El producto canónico es **un proyector**.
- Una cola remota exigiría: tabla o columna nueva de cursor, algún mecanismo de liderazgo/bloqueo entre pantallas, escrituras desde el navegador público (superficie nueva de seguridad) y reconciliación. Todo ello viola el principio de mínima complejidad sin un requisito que lo exija hoy.
- Costo de la cola local asumido y documentado en §3 y §6.

Información adicional realmente necesaria para el MVP: **ninguna columna nueva**. Únicamente se necesita leer campos que ya se leen (`id`, `content`, `created_at`, `published_at`, `status`).

---

## 3. Realtime + cola

Flujo propuesto:

```text
Supabase Realtime (postgres_changes, INSERT/UPDATE/DELETE de ideas)
        ↓
handler con dedup por id  ←→  (P1) delta refetch al reconectar
        ↓
ordenar/insertar en cola FIFO
        ↓
destacada (temporizador)
        ↓
transición CSS
        ↓
muro (últimas N)
```

### 3.1 Deduplicación

Ya funciona: el handler descarta ids conocidos antes de prepend. La cola debe aplicar la misma regla (`[HECHO]`).

### 3.2 Orden FIFO: ¿`created_at` es suficiente?

- `created_at` = momento de **envío**; `published_at` = momento de **publicación** (trigger). En modo `automatic` coinciden; en modo `approval` divergen (idea enviada hoy, aprobada mañana).
- **[DECISIÓN FUNCIONAL]**: FIFO por `created_at` (respeta "la primera enviada se presenta primero") o por `published_at` (respeta "la primera publicada se presenta primero"). La especificación dice *"la primera idea recibida"* → sugiere `created_at`, pero en modo aprobación "recibida" podría interpretarse como "recibida por el muro".
- **[HECHO]** `now()` en Postgres tiene precisión de microsegundo y cada INSERT es una transacción distinta: empates prácticamente no ocurren, pero **no está documentado que Realtime entregue los eventos en orden** → **[HIPÓTESIS]**. Mitigación mínima: al insertar en la cola, **ordenar** por `(created_at, id)` en vez de append ciego. Sin costo apreciable.

### 3.3 Ideas simultáneas y durante una presentación

Cubiertas por el diseño: la destacada no bloquea el handler; todo lo que llega entra a la cola y se ordena. La cola crece en memoria (límite teórico: tasa de llegadas × duración de presentación). **[HECHO]** por diseño; la política de cola extremadamente grande es **[DECISIÓN FUNCIONAL]** (§12).

### 3.4 Pérdida de conexión y reconciliación

- La librería reconecta y re-suscribe sola (heartbeat 25 s, backoff 1/2/5/10 s, rejoin de Phoenix). **[HECHO]**
- Los eventos de la ventana caída **no se re-emiten** (postgres_changes no tiene replay). **[HECHO documental]**
- Por lo tanto: **hace falta refetch**. Estrategia mínima recomendada **[DECISIÓN ARQUITECTÓNICA]**:
  1. Al pasar a `SUBSCRIBED` (y tras cada reconexión): traer las últimas N publicadas y **fusionar por id** con el estado local (no pisar la cola pendiente: fusionar, no reemplazar).
  2. P1: refetch periódico ligero (p. ej. cada 30-60 s) o al recuperar visibilidad de la pestaña, para detectar ocultamientos (AUD-004) sin depender de eventos.

### 3.5 Ventana de arranque (gap)

La query inicial es server-side al montar; la suscripción se abre después en `useEffect`. Una idea publicada en ese intervalo se pierde. **[HECHO]** (estructural: la suscripción es asíncrona). Mitigación: delta refetch cuando el canal confirma `SUBSCRIBED` → mismo mecanismo del punto anterior, idealmente en P0 porque viola el principio *"ninguna idea se pierde"*.

### 3.6 Impacto de AUD-003 y AUD-004 sobre el nuevo modelo

| Hallazgo | Efecto concreto sobre cola/presentación |
| --- | --- |
| AUD-003 (sin resync) | Idea publicada durante desconexión **nunca entra a la cola** → se muestra en el muro (si está en las N) pero **se salta la presentación individual**, violando el principio fundamental del modelo. |
| AUD-004 (ocultación sin evento) | Idea **ya en cola o destacada** permanece presentándose pese a estar oculta; idea en el muro permanece visible. |
| AUD-004 (borrado sí llega) | DELETE sí emite evento → la quita de cola/muro al instante. **[HECHO]** |

Ambos se resuelven con el mismo mecanismo (delta refetch), por eso se agrupan en P1.

---

## 4. Recarga de la pantalla pública

Casos analizados con **cola local (opción A)**:

| Caso | Comportamiento con cola local |
| --- | --- |
| Apertura primera | Carga últimas N ideas (ya presentadas históricamente) → **cola vacía**, muro poblado. Sólo las ideas que lleguen después se presentan. |
| Recarga con idea en plena presentación | La destacada y la cola se pierden; esa idea ya está en el set inicial → aparece como tarjeta del muro. **No se repite la presentación.** |
| Cierre y reapertura | Idéntico a la primera apertura. |
| Pérdida de conexión | Cola local intacta (no se congela: el handler sigue corriendo); lo que falta es el refetch (§3.5). |
| Ideas publicadas pero nunca presentadas por esa pantalla | Aparecen directamente en el muro (forman parte de las N cargadas), **sin momento individual**. |

**Recomendación: opción A (cola local) para el MVP.** **[DECISIÓN ARQUITECTÓNICA]**

La deficiencia real de A es una sola y es de producto: *las ideas no presentadas por una pantalla que se recarga no obtienen su momento de protagonismo*. La opción B (cola persistente) sólo elimina esa deficiencia a cambio de estado compartido, escrituras públicas y complejidad de sincronización. Dado que el historial completo permanece en la DB y la promesa al participante ("mi idea apareció… y forma parte del conjunto") se cumple con la tarjeta en el muro, **A es suficiente para el MVP** y B queda como evolución si el producto exige continuidad de presentación entre recargas o entre pantallas (P2).

**[DECISIÓN FUNCIONAL] explícita que debe tomarse:** qué ve la pantalla al recargar (§12.1): confirmar "cola vacía al cargar" como regla.

---

## 5. Múltiples pantallas

Mismo muro abierto en proyector + notebook + otro navegador con **cola local**:

- Cada instancia presenta a su propio ritmo: la misma idea puede mostrarse grande en una pantalla y ya formar parte del muro en otra. **[HECHO]** por diseño de A.
- No hay estado compartido → no hay conflictos, no hay bloqueos, no hay sorpresas de sincronización. **[HECHO]**
- Cargas iniciales distintas (si se abren en momentos distintos) → sets ligeramente distintos, convergentes porque todos leen las últimas N.

**Recomendación MVP:** cola independiente por pantalla; documentar la semántica ("cada pantalla presenta por su cuenta"). **[DECISIÓN ARQUITECTÓNICA]**

**Si el producto más adelante exige sincronización real**, el cambio mínimo no es "una cola en el servidor" sino **un cursor de presentación compartido**: p. ej. una columna en `activities` (o una tabla ligera) con la última idea presentada; cada pantalla, al arrancar y en cada refetch, presenta todo lo publicado *después* del cursor y lo avanza con un mecanismo de exclusión (advisory lock o update condicional). Eso es P2 y sólo si hay requisito explícito. **[DECISIÓN ARQUITECTÓNICA]**

Nota de capacidad: Supabase Free limita 200 conexiones Realtime concurrentes y 100 msg/s → 200 pantallas simultáneas como techo teórico. **[HECHO]** Irrelevante para MVP.

---

## 6. Escala: AUD-002 reinterpretado

El supuesto de Fase 2 (*"el muro renderiza todas las ideas publicadas"*) **deja de ser válido**. La arquitectura nueva separa:

```text
DB            →  conserva TODO (histórico completo, sin límite de producto)
Query inicial →  últimas N publicadas (orden por índice existente)
Cola          →  sólo ideas que llegan durante la sesión (vive en memoria)
Muro visual   →  máximo N tarjetas en el DOM
```

### 6.1 Qué debe consultar inicialmente el muro

`select … .eq("status","published").order("created_at", { ascending: false }).limit(N)` sobre el índice `(activity_id, status, created_at desc)`. **[HECHO]** que el índice lo soporta.

### 6.2 Límite de 1000 filas

- Con `N ≤ 1000` el truncamiento silencioso de PostgREST **deja de afectar al muro**. **[HECHO]**
- Sigue afectando al **panel** (`select *` de ideas/participants) y a cualquier consulta futura sin límite → P2/P3. **[HECHO]**
- El `.limit(N)` además convierte el "corte invisible" en un límite **explícito y deliberado**.

### 6.3 DOM y rendimiento

Manteniendo sólo N elementos en el estado, el DOM queda acotado: el coste por evento deja de crecer con el historial. Con N=60 (referencia):

- payload inicial ~35–55 KB (estimación de Fase 2: ~0,6–0,9 KB/idea);
- ~450 nodos de tarjeta;
- altura de página estable (~1.800 px), sin scroll infinito.

Todo **[ESTIMACIÓN]** derivada de los cálculos de Fase 2, **[NO VERIFICADO]** en navegador (sin browser disponible en Fase 2).

### 6.4 Cambio mínimo para el MVP

1. `.limit(N)` en `muro/[code]/page.tsx`.
2. En el estado del muro: al recibir una idea nueva, `slice(0, N)`.
3. Nada más. Sin cursor, sin paginación, sin virtualización. **[DECISIÓN ARQUITECTÓNICA]**

---

## 7. Moderación y cola (cruce con AUD-006 y AUD-004)

### 7.1 Idea en cola → es ocultada

- **No llega evento** (AUD-004: RLS filtra el UPDATE `published → hidden`). **[HECHO documental]**
- Detectable únicamente por refetch (§3.4).
- **Comportamiento funcional recomendado:** al detectar la ocultación, quitarla de la cola **y** de la destacada si estaba en pantalla, pasando a la siguiente. No hay animación de retiro de la destacada: se interrumpe y sigue la siguiente. **[DECISIÓN FUNCIONAL]** (la interrupción abrupta versus esperar al fin del ciclo es un detalle de UX a definir).

### 7.2 Idea visible en el muro → es ocultada

- Mismo problema: sin evento, permanece hasta el refetch.
- **No asumir retiro animado.** Evaluación: el muro es una grilla estática; quitar una tarjeta produce un reflow de posiciones. Durante una proyección, un desplazamiento súbito puede ser más disruptivo que la tarjeta en sí.
- **Comportamiento funcional recomendado:** retirar la tarjeta **sin animación especial**, aceptando el reflow, pero **sólo cuando se detecta** (refetch), no con transiciones llamativas. Alternativa pendiente: mantener la tarjeta hasta la siguiente recarga ("los cambios de moderación se ven al actualizar"). **[DECISIÓN FUNCIONAL]** pendiente (§12).

### 7.3 Ideas pendientes

Nunca entran al flujo público: RLS + grants impiden que un INSERT `pending` llegue al cliente público, y la query inicial filtra `status='published'`. **[HECHO]**

### 7.4 Interacción con el modo de moderación

- Modo `automatic`: se publica al instante → entra a la cola de inmediato.
- Modo `approval`: la idea se encola recién al ser aprobada (evento `pending → published` **sí** llega por RLS). **[HECHO]**
- El trigger sólo decide el estado inicial; cambiar el modo no re-procesa ideas existentes (comentario explícito en la migración `:236-238`). **[HECHO]**
- AUD-006 (sin UI de ocultar en modo `automatic`) **no lo resuelve ni empeora la cola**; sigue siendo una carencia de UI del panel. **[HECHO]**

---

## 8. Identidad visual

### Problema actual (Fase 2)

`className={idea-card idea-card-${index % 5}}` (`live-wall.tsx:91`) depende de la **posición**: con inserción al inicio, **cada idea nueva recolorea todas las tarjetas** (y de forma instantánea, porque `.idea-card` no tiene `transition`). **[HECHO]**

### Requisito del nuevo modelo

La identidad debe sobrevivir el ciclo completo:

```text
idea grande  →  transición  →  tarjeta en el muro   (mismo color/estilo)
```

…y además ser **independiente de la posición**, porque en el muro acotado las tarjetas se desplazan y salen.

### Decisión arquitectónica

**La variante visual debe derivarse de un valor estable de la idea (su `id`), no de su índice.** **[DECISIÓN ARQUITECTÓNICA]**

- Técnica concreta (hash del uuid módulo 5, mapa persistido, etc.) → **pendiente**, fuera de esta evaluación.
- Beneficio colateral: elimina el repaint global por evento (AUD-002/escala) y hace que la identidad de la tarjeta sea la misma en la presentación grande, en la transición y en el muro.
- Restricción: el hash debe estar en el cliente (la idea ya llega con `id`); sin cambios de DB.

---

## 9. Seguridad, spam y ownership (AUD-005 y AUD-007)

### 9.1 ¿La cola cambia algo respecto al abuso?

- **Riesgo de seguridad:** no. La cola es estado de un cliente público que ya puede leer esas ideas; no abre endpoints nuevos, no escribe en la DB, no expone datos nuevos. **[HECHO]**
- **Riesgo de producto:** **sí, aumenta**. Antes, 500 ideas spam = scroll molesto; ahora = 500 presentaciones en el proyector durante decenas de minutos, con la actividad secuestrada. El abuso pasa de "ruido" a "interrupción visible del evento". **[HECHO por diseño del modelo]**
- **Riesgo de rendimiento:** acotado: la cola crece en memoria (0,6–0,9 KB/idea estimado) → miles de ideas en cola = MBs, no es el cuello de botella; el problema es de experiencia, no de memoria. **[ESTIMACIÓN]**

### 9.2 Dónde debería aplicarse el control de frecuencia

Evidencia de Fase 2: el RPC `submit_idea` es `security definer` con `grant execute to anon`, invocable directo contra PostgREST con la anon key, **sin límite de ideas por participante** y sin rate limit de Supabase en la API de datos. **[HECHO]**

Lugares posibles, en orden de mínima complejidad:

1. **Dentro de la RPC**: límite de ideas por `participant_id`/email por ventana de tiempo (rechazo con error claro). Cambio de DB acotado, sin infraestructura nueva. **[DECISIÓN ARQUITECTÓNICA recomendada]**
2. Rate limit en el borde (Vercel/WAF): cubre el RPC y todo lo demás, pero es configuración externa y más gruesa.
3. CAPTCHA: sólo si (1) y (2) no alcanzan.

### 9.3 ¿Hay que resolverlo antes del MVP de presentación?

**Sí, al menos el límite por participante (P1, antes de exponer el muro en un evento real).** **[DECISIÓN ARQUITECTÓNICA]** Justificación: la cola convierte el spam en interrupción del evento en vivo; el costo de una validación en la RPC es bajo y no requiere nuevos servicios.

### 9.4 Ownership / RLS

- RLS exige `owner_id = auth.uid()` en los UPDATE de `ideas` y `activities` → **no hay escalada de privilegios**. **[HECHO]**
- Las 3 actions sin chequeo en app producen un update de 0 filas → fallo silencioso, no un agujero de seguridad. **[HECHO por RLS / HIPÓTESIS en el detalle UX del silencio]**
- **Suficientes para el MVP:** sí. Añadir los checks en app es **deuda técnica (P3)** por consistencia con `deleteActivityAction`, no un requerimiento de seguridad. **[DECISIÓN ARQUITECTÓNICA]**

### 9.5 Separación de riesgos

| Categoría | Contenido |
| --- | --- |
| **Riesgo de seguridad** | Sin superficie nueva por la cola. Ownership cubierto por RLS. Queda el RPC abierto a automatización (ya existente, no creado por este modelo). |
| **Riesgo de producto** | Spam visible en proyector; ideas no presentadas tras recarga; divergencia entre pantallas; moderación con demora visible. |
| **Mejora futura** | Límite por participante en RPC, cursor de presentación compartido, panel en vivo, checks de ownership en app. |

---

## 10. Arquitectura recomendada para MVP

Todo en el cliente de `/muro/[code]`; **cero nuevas tablas, cero servicios, cero librerías nuevas**.

```text
┌─────────────────────── /muro/[code] (cliente) ────────────────────────┐
│                                                                       │
│  Server Component (query inicial)                                     │
│    select … status=published order created_at desc limit N            │
│              │ initialIdeas                                           │
│              ▼                                                        │
│  ┌───────────────────── estado React ──────────────────────┐          │
│  │  wall:    Idea[]   (máx. N, orden de grilla)            │          │
│  │  queue:   Idea[]   (FIFO, orden (created_at, id))       │          │
│  │  featured: Idea|null (temporizador de presentación)     │          │
│  │  channel: 'SUBSCRIBED' | error (indicador EN VIVO)      │          │
│  └──────────────────────────────────────────────────────────┘          │
│        ▲                         │                                    │
│        │ eventos (dedup por id)  │ tick de presentación               │
│  Realtime ───────────┐           ▼                                    │
│  (postgres_changes)  │   destacada → transición CSS → wall (slice N)  │
│                      │                                                │
│  (P1) delta refetch ─┴── fusiona por id, respeta queue pendiente      │
│                                                                       │
│  identidad visual = f(idea.id)  (constante en todo el ciclo)          │
└───────────────────────────────────────────────────────────────────────┘
```

**Máquina de estados (conceptual):**

```text
RECIBIDA ──► COLA (FIFO) ──► DESTACADA (T1) ──► TRANSICIÓN (T2) ──► MURO (≤ N)
   │              ▲                                   │
   │              └── llegadas simultáneas ───────────┘ (slice al final)
   └── sólo si status = published
```

Supuestos explícitos:

- Duraciones T1/T2 → **decisión funcional** (§12).
- Animación con **CSS/transiciones nativas**; no se introduce librería de animación sin evidencia de que CSS no alcanza. **[DECISIÓN ARQUITECTÓNICA]**
- `aria-live` del grid debe revisarse con el nuevo flujo (evitar anuncio caótico por idea). P2.

---

## 11. Decisiones funcionales pendientes (producto)

1. **Regla de recarga:** confirmar "cola vacía al cargar; sólo las ideas nuevas se presentan" (§4).
2. **Criterio FIFO:** `created_at` (envío) vs `published_at` (publicación) — relevante en modo `approval`.
3. **Duración de la presentación individual (T1) y de la transición (T2).**
4. **N:** cantidad máxima de tarjetas visibles en el muro.
5. **Cola muy grande:** acelerar la presentación, mantener ritmo fijo, o mostrar un indicador ("+12 ideas en espera"). El MVP **no debe descartar** ideas.
6. **Moderación sobre idea en cola/destacada:** interrupción inmediata vs fin de ciclo (§7.1).
7. **Moderación sobre tarjeta visible:** retiro con reflow inmediato vs al próxima recarga (§7.2).
8. **Pausar/reanudar la presentación** (¿control del organizador?).
9. **Comportamiento al cerrar la actividad:** ¿la destacada/cola se vacían, se termina de presentar lo encolado?
10. **Múltiples pantallas:** aceptar ritmos independientes (recomendado) o exigir sincronía (activa P2).
11. **Identidad visual:** regla de asignación de colores/variantes.

---

## 12. Decisiones arquitectónicas recomendadas

| # | Decisión | Clase | Fundamento |
| --- | --- | --- | --- |
| A1 | Cola **local** al cliente del muro para el MVP | Arquitectónica | Sin requisito de estado compartido; DB = fuente de verdad; evita tablas/locks/escrituras públicas (§4) |
| A2 | **Sin nuevas tablas ni servicios**; todo el modelo en estado React | Arquitectónica | Principio de mínima complejidad; el esquema actual ya soporta el flujo (§2) |
| A3 | Query inicial con **`.limit(N)`** + `slice(0,N)` en el estado | Arquitectónica | Mata AUD-002 y acota el DOM con un cambio de 2 líneas (§6) |
| A4 | Orden FIFO por **`(created_at, id)`** ordenado al insertar, no append ciego | Arquitectónica | Orden de entrega de Realtime no garantizado (§3.2) |
| A5 | **Delta refetch** al (re)conectar y periódico/en foco | Arquitectónica | Soluciona AUD-003 y AUD-004 con un solo mecanismo (§3.4) |
| A6 | Identidad visual derivada del **`id`**, no del índice | Arquitectónica | Estabilidad exigida por el modelo + elimina repaint global (§8) |
| A7 | Animación con **CSS nativo**, sin librerías | Arquitectónica | Sin evidencia de insuficiencia (§10) |
| A8 | Límite de ideas por participante **dentro de la RPC** antes del evento real | Arquitectónica | La cola amplifica el spam; cambio acotado y sin infra nueva (§9.3) |
| A9 | Cursor de presentación compartido **sólo en P2**, si el producto lo pide | Arquitectónica | Evolución mínima para multi-pantalla sincronizada (§5) |
| A10 | Ownership checks en app = **deuda (P3)**, no requerimiento de seguridad | Arquitectónica | RLS ya lo garantiza (§9.4) |

---

## 13. Roadmap

### P0 — necesario para implementar el modelo

| # | Problema | Decisión | Cambio mínimo | Riesgo | Validación |
| --- | --- | --- | --- | --- | --- |
| P0.1 | El muro renderiza todo el historial (AUD-002) | A3 | `.limit(N)` en la query + `slice(0,N)` al encolar en el muro | N mal elegido (poco muro o payload grande) | Abrir un muro con >1000 ideas: verifica límite, payload y scroll |
| P0.2 | No existe la presentación individual | Máquina de estados en `LiveWall` | Extraer `queue/featured/wall` en estado React con temporizador; sin libs | Complejidad en un solo componente | Prueba manual con eventos simulados (inyectar ideas en el handler) |
| P0.3 | Identidad visual inestable (colores por índice) | A6 | Derivar variante de `idea.id`; dejar de usar `index % 5` | Variantes mal distribuidas | Mural con 50+ ideas: ninguna cambia de color al llegar una nueva |
| P0.4 | Orden FIFO no garantizado | A4 | Ordenar cola por `(created_at, id)` al insertar | Descarte: ninguno relevante | Insertar varias ideas "simultáneas" y verificar orden |
| P0.5 | Gap entre query inicial y suscripción | Delta refetch tras `SUBSCRIBED` | Re-consulta de las últimas N + fusión por id al confirmarse el canal | Doble carga inicial (aceptable) | Publicar una idea en el instante de cargar y verificar que aparece |
| P0.6 | Regla de recarga indefinida | Decisión funcional §11.1 | Documentar "cola vacía al cargar" y codificarlo | Ideas sin su momento tras F5 (aceptado y comunicado) | Recargar durante una presentación y verificar estado coherente |
| P0.7 | Transición destacada→muro | A7 | Transición CSS nativa (sin librería) | Framer-level de calidad no alcanzable con CSS | Revisión visual en el proyector real |

### P1 — necesario para robustez

| # | Problema | Decisión | Cambio mínimo | Riesgo | Validación |
| --- | --- | --- | --- | --- | --- |
| P1.1 | Eventos perdidos en desconexión / ocultamientos sin evento (AUD-003/004) | A5 | Delta refetch periódico/al foco + fusión por id respetando la cola pendiente | Tráfico extra (despreciable: 1 query/N seg) | Desconectar la red 30 s con ideas nuevas y reconectar: todas aparecen |
| P1.2 | `.subscribe()` sin manejo de estado | Indicador EN VIVO / reconectando | Callback de estado + UI de estado en la cabecera | Falsos positivos/negativos del indicador | Corte de red: verificar transiciones del indicador |
| P1.3 | Idea oculta permanece en cola/muro | Al detectar por refetch: quitar de cola/destacada/muro | Lógica de purga en la fusión del refetch | Interrupción abrupta de la destacada (UX a definir §11.6) | Ocultar desde el panel y verificar desaparición en ≤1 ciclo |
| P1.4 | Spam = secuestro del proyector (AUD-005) | A8 | Límite por participante/ventana dentro de `submit_idea` + política de velocidad de cola (§11.5) | Rechazar ideas legítimas en ráfaga (ajustar ventana) | Script de 100 envíos: verificar límite y mensaje de error |
| P1.5 | Fallo silencioso en actions | Devolver error explícito al usuario | Chequear resultado y mostrar mensaje (3 actions) | Cambio de comportamiento visible (mejora) | Intento no-propio: verificar mensaje en UI |

### P2 — escalabilidad y mejoras

| # | Problema | Decisión | Cambio mínimo | Riesgo | Validación |
| --- | --- | --- | --- | --- | --- |
| P2.1 | Varias pantallas presentan a ritmos distintos (§5) | A9: cursor de presentación persistido | Columna/tabla de cursor + avance condicional; sólo si producto lo pide | Complejidad de sincronización y de concurrencia | 2 pantallas: misma secuencia de presentación |
| P2.2 | Panel sujeto al límite de 1000 filas | Paginación o `.range()` en el panel | Paginación por offset/rango | — | Panel con >1000 ideas |
| P2.3 | `aria-live` con flujo de presentación | Redefinir región y mensajes | Ajustar `aria-live` para anunciar sólo la destacada | Menor | Lector de pantalla durante una sesión simulada |
| P2.4 | Si N crece mucho | Virtualización | Sólo si las métricas lo piden | Complejidad innecesaria prematura | Medir con N grande |

### P3 — deuda técnica

| # | Problema | Decisión | Cambio mínimo | Riesgo | Validación |
| --- | --- | --- | --- | --- | --- |
| P3.1 | Working tree sucio: 12 archivos modificados + 1 sin trackear (6 reales, 6 sólo CRLF) | Revisar y commitear limpio | Revisión diff + commit + `core.autocrlf` consistente | Pérdida de trabajo | `git status` limpio |
| P3.2 | Sin CI | Pipeline mínimo | `biome check` + `tsc --noEmit` + `next build` en CI | — | PR de prueba |
| P3.3 | Checks de ownership ausentes en 3 actions | A10 | Añadir `.eq("owner_id", user.id)` por consistencia | Ninguno (refuerzo) | Tests manuales por rol |
| P3.4 | `docs/arquitectura.md` no refleja el nuevo modelo | Actualizar al implementar P0 | Sección de cola/presentación | — | Revisión |
| P3.5 | Demora de moderación visible en muro (AUD-004) | Comunicada como limitación hasta P1.3 | Documentar | Exposición en evento si P1 no corre | — |

---

## 14. Riesgos

| Riesgo | Severidad | Mitigación |
| --- | --- | --- |
| Secuestro del proyector por spam (AUD-005 + cola) | **Alta** | P1.4 antes de cualquier evento real |
| Ideas perdidas en desconexión → se saltan la presentación (AUD-003) | **Alta** para el principio del modelo | P0.5 + P1.1 |
| Ocultamiento no propagado: idea moderada sigue en pantalla (AUD-004) | **Media-Alta** (riesgo reputacional en evento) | P1.1 + P1.3; si hay evento antes de P1, considerar F5 manual |
| Recarga pierde la cola → ideas sin su momento individual | **Media** (funcional, aceptada) | Decisión §11.1 comunicada; evolución P2.1 si el producto la exige |
| N mal calibrado (pocas ideas visibles o payload grande) | **Media** | Elegir N con métricas de Fase 2; validar con volumen real |
| Varios proyectores divergen | **Baja** (aceptada en MVP) | Documentado; P2.1 si se necesita |
| Interrupción abrupta de una idea destacada por moderación | **Baja** (UX) | Decisión §11.6 |
| CSS insuficiente para la transición deseada | **Baja** | Revisar en el proyector antes de considerar librería |
| Medir rendimiento sin navegador (Fase 2) | **Media** de incertidumbre | Validar P0.1 con capturas de Performance en navegador real |

---

## 15. Anexo: clasificación de afirmaciones

### HECHOS (demostrados por código/docs)

- El muro no limita la query; PostgREST trunca en 1000 filas (hosted y local).
- Realtime deduplica por `id` en el handler actual; `payload.old` sólo trae PKs; DELETE no se filtra por RLS; INSERT/UPDATE sí.
- Heartbeat 25 s, backoff 1/2/5/10 s y rejoin automáticos en la librería; no hay resync ni refetch en la app.
- Grants anon incluyen `created_at` y `published_at`; índice `(activity_id, status, created_at desc)`; trigger mantiene `published_at`.
- `submit_idea`: `security definer`, ejecutable por `anon`, sin límite de ideas por participante; Supabase no rate-limitea la API de datos.
- RLS exige `owner_id` en UPDATE de `ideas` y `activities`.
- La identidad visual depende del índice y cambia con cada inserción.
- La suscripción se abre después de la query inicial (ventana de gap).
- `npm run build` OK (Next.js 16.3.8, 0 errores).

### HIPÓTESIS (requieren validación)

- Realtime no garantiza el orden de entrega de eventos.
- Tiempos de render/presentación por volumen (estimaciones de Fase 2, sin navegador).
- Detalle del "fallo silencioso" de las actions cuando RLS matchea 0 filas.
- Idoneidad de CSS puro para la transición destacada→muro.
- Distribución de variantes visuales si se deriva de un hash del `id`.

### DECISIONES FUNCIONALES (producto)

- Regla de recarga de la pantalla; criterio FIFO (`created_at` vs `published_at`); T1/T2; N; política de cola grande; comportamiento de moderación en cola/destacada y en tarjeta visible; pausa/reanudación; cierre de actividad; semántica multi-pantalla; regla de identidad visual.

### DECISIONES ARQUITECTÓNICAS (recomendadas aquí)

- A1 cola local · A2 sin infra nueva · A3 `.limit(N)`+slice · A4 orden `(created_at, id)` · A5 delta refetch · A6 identidad por `id` · A7 CSS nativo · A8 límite en RPC antes del evento · A9 cursor compartido sólo en P2 · A10 ownership en app = deuda P3.

---

## 16. Fuera de alcance de este documento

- Implementación de código, migraciones o configuración (no realizados en esta fase).
- Selección de librerías de animación.
- Estructura final de tablas (no se requieren cambios).
- Parámetros concretos (N, T1, T2) — dependen de decisiones funcionales §11.
