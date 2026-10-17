# Estado actual del producto — Muro Participativo de Ideas ("muro común")

**Fecha:** 08/10/2026 · **Última actualización:** 16/10/2026 (cierre de D4/T7 — mensaje de éxito según estado real)
**Propósito:** fuente de verdad única sobre qué producto estamos construyendo, qué decisiones están aprobadas, qué está implementado, qué está validado y qué falta.
**Alcance de este documento:** producto + arquitectura. No es un inventario de archivos ni un plan de refactor.
**Fuentes:** implementación actual del repositorio (incluidos los commits de `feat/pagina-administracion`), `docs/evaluacion-cola-de-presentacion.md`, `docs/arquitectura.md`, `docs/modelo-de-datos.md`, `docs/despliegue.md`, README, migraciones de Supabase, y la evidencia de validación disponible.
**Lo que este documento NO hace:** no cambia código, no modifica arquitectura, no crea decisiones nuevas, no corrige discrepancias (sólo las registra).

---

## 1. Propósito del producto

### Problema que resuelve

En un evento, taller o reunión, las ideas de los participantes se pierden: se anotan en papeles, se dicen y se olvidan, o quedan en un chat que nadie vuelve a leer. No hay un lugar único donde la voz de todos sea visible, ordenada y compartida.

### Experiencia que busca generar

- El participante, **sin crear cuenta**, escribe su idea desde el celular (enlace o QR) y recibe confirmación inmediata de que fue recibida.
- El proyecto, en una pantalla grande, **le da protagonismo individual a cada idea**: una por vez, en orden de llegada, con su momento de atención.
- Terminada esa presentación, la idea **pasa a formar parte del muro colectivo**: un conjunto visible, ordenado y acotado, que muestra la conversación completa sin saturar la pantalla.
- El organizador administra (crea, modera, cierra, elimina) sin intervención manual sobre cada proyección.

### Diferencia frente a un muro o listado tradicional

| Listado tradicional | Este modelo |
| --- | --- |
| Render directo: todo llega al mismo tiempo al grid | **Cola de presentación**: cada idea tiene su momento individual primero |
| La idea nueva compite visualmente con todas las demás | La idea **destacada ocupa la pantalla grande** durante un tiempo fijo |
| Sin orden garantizado ni ritmo | **FIFO estricto** y ritmo constante (hold + transición) |
| Scroll indefinido / historial completo en pantalla | **Muro acotado** (últimas 48 tarjetas), historial completo resuelto en la base de datos |
| Lo que llega durante una desconexión se pierde | **Resync**: reconciliación por cursor al reconectar y periódicamente |

La idea central del producto: **enviar no es lo mismo que aparecer**. El flujo tiene una etapa de presentación (`Enviar → Cola → Presentación grande → Transición → Muro`) que es la experiencia, no un detalle de implementación.

---

## 2. Modelo funcional

```text
Enviar → Cola → Presentación grande → Transición → Muro
```

| Etapa | Comportamiento |
| --- | --- |
| **Enviar** | Participante envía nombre, apellido, email e idea desde `/a/[code]`. Server Action → RPC `submit_idea`. La idea queda persistida en la DB con estado `pending` o `published` según el modo de moderación. |
| **Cola** | En la pantalla del muro, las ideas publicadas entran a una **cola FIFO local**. La cola nunca descarta ideas ni tiene límite de tamaño. |
| **Presentación grande** | La cabeza de la cola se muestra como **featured** (tarjeta grande) durante **8 segundos** (`hold=8s`), con barra de progreso y contador "+N en espera". |
| **Transición** | Fase `transitioning` de **700 ms** hacia el muro. |
| **Muro** | La idea se incorpora a la grilla de **máximo 48 tarjetas** (`N=48`); las que exceden salen del DOM. |

Conceptos del modelo:

- **FIFO estricto:** orden `(created_at ASC, id ASC)`. El orden se aplica al ordenar la cola en cada inserción (no hay append ciego), porque el orden de entrega de Realtime no está garantizado.
- **Múltiples ideas simultáneas:** la presentación no bloquea el ingreso. Todo lo que llega entra a la cola y se ordena; las llegadas simultáneas se resuelven por el comparador FIFO.
- **Featured:** una sola idea a la vez en pantalla grande; tiene fases `holding` y `transitioning`.
- **Wall (muro):** representación visual acotada; sólo contiene lo que ya se presentó (más la línea base inicial).
- **Queue (cola):** estado en memoria de la pantalla, ordenado, sin tope; visible vía el contador "+N en espera".
- **Persistencia histórica en DB:** la base de datos conserva **todas** las ideas sin límite de producto; el límite de 48 es puramente visual. La DB es la única fuente de verdad.
- **Límite visual de 48 ideas:** la query inicial trae las últimas 48 publicadas y el estado local mantiene `slice(0, 48)`.
- **Ideas pendientes de moderación:** en modo `approval` la idea queda `pending`; nunca entra a la cola ni al muro (RLS + query filtran `status='published'`), hasta que el organizador la aprueba.

---

## 3. Decisiones funcionales aprobadas (vigentes)

Verificadas contra la implementación actual:

| # | Decisión | Estado en código | Referencia |
| --- | --- | --- | --- |
| 1 | **Cola local por pantalla** (cada instancia del muro presenta a su ritmo; sin estado compartido) | ✅ implementada | Estado React por instancia en `src/components/live-wall.tsx` |
| 2 | **FIFO `(created_at, id)`** | ✅ implementada | `compareIdeasFIFO`, `src/lib/presentation.ts:44` |
| 3 | **N=48** (límite visual de tarjetas) | ✅ implementada | `MAX_WALL_CARDS`, `src/lib/presentation.ts:3` |
| 4 | **hold = 8 s** | ✅ implementada | `HOLD_DURATION_MS`, `src/lib/presentation.ts:4` |
| 5 | **Transición = 700 ms** | ✅ implementada | `TRANSITION_DURATION_MS`, `src/lib/presentation.ts:5` |
| 6 | **CAP = 100 por batch, sin descartar ideas de la cola** | ✅ implementada | `BATCH_CAP` sólo limita cada query; `enqueueIdeas` no tope ni descarta (`src/lib/presentation.ts:115-140`) |
| 7 | **Primera apertura sin catch-up histórico** (las ideas ya existentes sólo pueblan el muro; sólo se presentan las posteriores) | ✅ implementada | `src/components/live-wall.tsx:443-459` |
| 8 | **Cursor `{createdAt, id}`** con avance monótono | ✅ implementada | tipo `Cursor`, `maxCursor`, `src/lib/presentation.ts:17,88` |
| 9 | **Resync** (delta refetch al reconectar y periódico) | ✅ parcialmente implementada | `SUBSCRIBED → requestReconcile()` + intervalo de 10 s (`live-wall.tsx`); ver discrepancias D2 y §6 |
| 10 | **`sessionStorage`** para el cursor por actividad | ✅ implementada | clave `muro_cursor2_<CÓDIGO>`, `src/lib/presentation.ts:237` |
| 11 | **Identidad visual por `idea.id`** (no por índice) | ✅ implementada | `getCardVariant` (hash del id módulo 5), `src/lib/presentation.ts:32` |
| 12 | **Moderación durante cola / featured / wall** (retiro al detectar, con interrupción de la destacada) | ✅ implementada | verificación antes de promover (`live-wall.tsx:170-199`), `purgeModeratedIdeas`, `removeIdea` y handler Realtime (`live-wall.tsx:420-521`) |

No se registran aquí decisiones nuevas. Las decisiones que siguen abiertas están en `docs/evaluacion-cola-de-presentacion.md` §11 y en el roadmap (§10 de este documento).

---

## 4. Arquitectura actual

### Flujo real

```text
Participante (celular)
  → /a/[code] (formulario público)
  → Server Action submitIdeaAction (validación zod)
  → RPC SQL submit_idea (SECURITY DEFINER: valida actividad abierta,
    registra participante, idea y autoría; el modo define pending|published)
  → DB (PostgreSQL + RLS)  ← única fuente de verdad
  → Supabase Realtime (postgres_changes sobre ideas)
  → Cola local de la pantalla del muro (FIFO, dedup por id)
  → Presentación grande (hold 8 s) → Transición (700 ms)
  → Muro visual (≤ 48 tarjetas)
```

### Papel de cada capa (no intercambiables)

| Capa | Rol | Lo que NO es |
| --- | --- | --- |
| **Base de datos** | **Fuente de verdad**: histórico completo, estados de moderación, orden de creación. Todo lo que la cola contiene ya está persistido y es recuperable desde aquí. | No conoce nada de la presentación. |
| **Supabase Realtime** | **Mecanismo de notificación**: avisa "hay algo nuevo / cambió / se borró". Dedup por `id` antes de encolar. | **No es fuente de verdad** y no repite eventos perdidos (sin replay): por eso existe el resync. |
| **Cola local (cliente del muro)** | **Controlador de presentación**: decide qué se muestra grande, en qué orden y cuándo pasa al muro. | No es estado compartido: cada pantalla presenta por su cuenta. |
| **Muro visual** | **Representación acotada**: ≤ 48 tarjetas, identidad estable por `id`, salida de las que exceden. | No es el histórico: el histórico vive en la DB. |
| **Server Actions + RPC** | Única vía de escritura pública; validación antes de escribir; RLS y `SECURITY DEFINER` como frontera de autorización. | No participan del ciclo de presentación. |

### Continuidad con la arquitectura del MVP

`docs/arquitectura.md` describe correctamente stack, seguridad, rutas y flujos de autenticación, pero **describe el muro como "actualización en vivo" sin el modelo cola → destacada → transición → muro** (discrepancia D6). El modelo de presentación vive hoy en el código y en `docs/evaluacion-cola-de-presentacion.md`.

---

## 5. Estado de implementación

Categorías usadas (definiciones estrictas):

- **Implementado:** código completo y consistente con la decisión aprobada.
- **Parcialmente implementado:** existe pero cubre sólo parte de lo aprobado.
- **Validado técnicamente:** verificado por herramientas (typecheck, linter, build, mediciones HTTP/DB de sólo lectura, lectura de código). **No implica validación funcional del producto.**
- **Validado manualmente:** ejecutado en navegador/dispositivo por una persona verificando el comportamiento esperado. Hay validación parcial local registrada en §8.2; FIFO, recuperación de red y otras condiciones siguen pendientes.
- **Pendiente de validación:** implementado (o parcial) pero sin evidencia manual.
- **Fuera de alcance del MVP:** decidido como no objetivo del MVP.

### 5.1 Implementado

| Aspecto | Categoría | Evidencia |
| --- | --- | --- |
| Modelo completo `Enviar → Cola → Featured → Transición → Muro` | Implementado / pendiente de validación manual | `src/components/live-wall.tsx`, `src/lib/presentation.ts` |
| FIFO `(created_at, id)`, N=48, hold 8 s, transición 700 ms, CAP 100 sin descartes | Implementado / pendiente de validación manual | constantes y funciones de `src/lib/presentation.ts` |
| Primera apertura sin catch-up histórico; cursor `{createdAt,id}` en `sessionStorage` con `NULL_MARKER` | Implementado / pendiente de validación manual | `live-wall.tsx:439-494`, `presentation.ts:234-280` |
| Identidad visual estable por `idea.id` (5 variantes por hash) | Implementado / pendiente de validación manual | `presentation.ts:32` |
| Resync al `SUBSCRIBED` + resync periódico 10 s, con single-flight y pending-rerun | Implementado (parcial según D2) / validado manualmente en local para inserción y republicación | `live-wall.tsx:258-393, 496-543` |
| Moderación durante cola/featured/wall: verificación antes de promover, purga acotada a IDs consultadas, interrupción de la destacada, retiro por evento Realtime | Implementado / validación manual parcial; falta cubrir cola y destacado en todos los estados | `live-wall.tsx:170-199, 323-333, 420-436`, `presentation.ts:186-232` |
| Query inicial con `.limit(48)` | Implementado / validado técnicamente (lectura de código + build) | `src/app/muro/[code]/page.tsx:22-26` |
| UX de envío: `Enviando…` + spinner, botón bloqueado (`disabled` + `aria-busy`), confirmación real del servidor, mensaje de espera en cola, limpieza del textarea, preservación de identidad, conservación del contenido ante error, focus + scroll al mensaje | Implementado / pendiente de validación manual en dispositivo | `src/components/idea-form.tsx`, estilos nuevos en `src/app/globals.css` |
| QR y enlace de participación derivados del origen efectivo (`getBaseUrl()` por headers + `window.location.origin` en cliente) | Implementado / pendiente de validación manual con celular | `src/lib/site-url.ts`, `share-qr-panel.tsx`, `live-wall.tsx:440` |

### 5.2 Parcialmente implementado

| Aspecto | Qué falta | Referencia |
| --- | --- | --- |
| Resync (decisión 9) | Falta refetch **al recuperar la visibilidad de la pestaña** (foco), previsto en la evaluación §3.4/A5. Hoy: sólo `SUBSCRIBED` + cada 10 s. | Discrepancia D2 |
| Modelado del QR/LAN | La corrección aprobada (abrir panel vía `http://192.168.1.12:3000`) depende de que el organizador acceda desde esa URL; no hay una validación en dispositivo. | Discrepancia D8 |

### 5.3 Pendiente de validación (implementado, sin evidencia manual)

Ciclo completo de presentación en navegador · FIFO con ideas simultáneas · purga por moderación visible · reconexión/resync · recarga con cursor en `sessionStorage` · límite de 48 con >48 ideas · escaneo de QR desde celular · spinner y mensajes de envío en dispositivo · posibles envíos dobles en desarrollo · >1000 ideas (límite de PostgREST). Detalle en §8.

### 5.4 Fuera de alcance del MVP

Roles de administrador global · votos · analítica de moderación · retención automática de datos · PWA (manifiesto/service worker) · múltiples pantallas sincronizadas (cursor compartido) · configuración de un límite de envío distinto del tope técnico vigente de 5 ideas por participante y actividad en 60 s · paginación del panel sobre >1000 filas · virtualización de la grilla · CI/CD.

---

## 6. Robustez — correcciones P0 ya implementadas

Correcciones de robustez presentes en la implementación actual del muro, registradas en los commits de `feat/pagina-administracion`. Se documentan por su **comportamiento**; los identificadores (`I*`, `CA-*`, `H-*`, "Sección *") provienen de la especificación funcional de la cola (ver discrepancia D3: ese documento no está en el repo).

| Corrección | Comportamiento implementado | Referencia |
| --- | --- | --- |
| **Stale snapshot** (`I8`, `CA-1`) | La reconciliación toma una fotografía fresca del estado (`stateRef`) *después* de las queries y opera sobre esa, no sobre un estado leído antes de esperar. | `live-wall.tsx:307-351` |
| **Error ≠ vacío** (`I7`) | Si la query de moderación falla, **no se purga nada** (sólo se purga sobre IDs efectivamente consultadas y confirmadas); error silencioso que no altera estado. | `live-wall.tsx:323-333, 367-369`, `purgeModeratedIdeas` |
| **Recarga** (`H-03`) | Al recargar, si hay cursor en `sessionStorage`: el muro se puebla con la línea base, las ideas posteriores al cursor entran a la cola (elegibles para presentación), y se dispara una reconciliación inmediata. Sin cursor (primera apertura): sin catch-up histórico. | `live-wall.tsx:439-494` |
| **Cursor compuesto** | `{createdAt, id}` con comparación lexicográfica estricta en ambos ejes; avance monótono (`maxCursor`); nunca retrocede. | `presentation.ts:44-99` |
| **Watermark** | Marca de "hasta dónde se descubrió por DB" separada del cursor de "hasta dónde se presentó": la descubrición avanza el watermark; el cursor sólo avanza cuando la idea completó su presentación **y** el watermark la cubre (`I5`), evitando saltos de presentación. | `live-wall.tsx:128-133, 241-250, 314-320` |
| **Reconciliación** | Descubrición lexicográfica (`created_at, id`) con `limit(100)` + moderación acotada a las IDs de wall+featured (≤49), en paralelo; fusión por ID sin pisar la cola pendiente. | `live-wall.tsx:258-370` |
| **Single-flight** (`I9`) | Una sola reconciliación a la vez; si llega un pedido mientras corre, queda `pendingRerun` y se re-ejecuta al finalizar. | `live-wall.tsx:372-393` |
| **Moderación** | Doble protección: (a) verificación puntual del estado de la cabeza antes de promover (retira y sigue); (b) purga por reconciliación de wall+featured con interrupción de la destacada. Borrado (DELETE) se retira al instante vía evento. | `live-wall.tsx:170-199, 323-333, 420-436` |
| **Reconnect / resync** | La suscripción reconecta sola (librería); al confirmar `SUBSCRIBED` se reconcilia; además reconciliación periódica cada 10 s; en estado IDLE la cola re-consulta antes de promover (catch-up de discovery). | `live-wall.tsx:82-159, 496-543` |

---

## 7. UX de envío de ideas (comportamiento aprobado)

Comportamiento aprobado y su estado actual en `src/components/idea-form.tsx`:

| Requisito aprobado | Estado | Cómo está implementado |
| --- | --- | --- |
| **Enviando + spinner** | ✅ implementado | Botón muestra `<span class="button-spinner"/> Enviando…` durante `pending` |
| **Botón bloqueado** | ✅ implementado | `disabled={pending}` + `aria-busy` + prevención de reenvío en `onSubmit` + anuncio `aria-live` "Enviando tu idea…" |
| **Confirmación real del servidor** | ✅ implementado | El mensaje de éxito sólo se muestra si la Server Action devolvió `success` (no hay confirmación optimista) |
| **Mensaje de éxito según estado real** | ✅ implementado (2026-10-16) | El bloque de éxito muestra textualmente el `state.success` devuelto por el servidor: "¡Tu idea ya está en el muro!" (publicada) o "¡Gracias! Tu idea quedó pendiente de aprobación." (pendiente); se eliminó la inferencia por subcadena (D4/T7) |
| **Limpieza del textarea** | ✅ implementado | Al pasar de `pending` a terminado **con** `success`: `setContent("")` |
| **Preservación de identidad** | ✅ implementado | Nombre/apellido/email viven en estado controlado que no se resetea; además se persisten en `localStorage` por actividad para no volver a completarlos |
| **Conservación del contenido ante error** | ✅ implementado | El textarea es controlado: el contenido **no** se borra si el servidor devuelve `error`; además se hace focus y scroll al mensaje de error |

Mensajería actual (tras cierre de D4, 2026-10-16):

- **Éxito (mostrado):** título "¡Idea enviada!" + el texto literal devuelto por el servidor: "¡Tu idea ya está en el muro!" (idea publicada, modo `automatic`) o "¡Gracias! Tu idea quedó pendiente de aprobación." (modo `approval`).
- **Error (mostrado):** título "No pudimos enviar tu idea" + el texto devuelto por el servidor.

> ✅ **Problema funcional D4 cerrado (2026-10-16, tarea T7):** `idea-form.tsx` dejó de reconstruir el mensaje por subcadena (`includes("aprobaci")`) y ahora muestra el mensaje del servidor tal cual. Validado en local en ambos modos: mensajes exactos y estados reales `published`/`pending` coincidentes entre panel y SQL (ver §8.2). Limitación: Chrome headless local; sin pruebas en otros navegadores ni dispositivos móviles.

---

## 8. Validación realizada

### 8.1 Validación técnica (herramientas / mediciones — NO es validación funcional del producto)

Realizada el 08/10/2026 salvo donde se indica:

| Verificación | Resultado | Alcance real |
| --- | --- | --- |
| `npx tsc --noEmit` | ✅ exit 0, sin errores | Consistencia de tipos |
| `npx biome check` | ✅ 35 archivos, 0 problemas | Estilo y reglas estáticas |
| `npm run build` | ✅ exit 0 (compilación 8,5 s; 11 rutas generadas; proxy/middleware activo) | **Validación técnica de compilación. No valida el comportamiento del producto en navegador.** |
| `npm run build` declarado en `docs/evaluacion-cola-de-presentacion.md` | ✅ OK en Fase 2 | Referencia histórica |
| Medición HTTP del formulario público `/a/[code]` (warm) | ~110-215 ms (promedio ~136 ms), incluye proxy + SSR + query a Supabase | Rendimiento de la página, no del clic |
| Medición directa de la RPC `submit_idea` | ~10 ms warm / ~201 ms primera invocación | Backend no es el cuello de botella |
| Medición del POST de la Server Action (camino MPA, ×5) | 120-182 ms; contador de ideas sin cambios (payload inválido a propósito: validación antes de escribir) | Orden de magnitud del envío |
| Lectura directa de DB | 16 ideas en la actividad de prueba; detectadas ideas duplicadas por contenido (p. ej. "Prueba 1" ×12 en 11 s; dos escrituras con 153 ms de diferencia) | Evidencia de duplicados reales (D7) |
| Acceso desde LAN | Rutas `/a/…` y `/muro/…` y `/_next/*` responden 200 desde `192.168.1.12`; requests con `Origin` cross-origin a `/_next/*` responden 403 (`allowedDevOrigins` sin configurar); Server Actions responden OK desde LAN | Disponibilidad básica desde la red local, no en teléfono |
| Inspección de código de todas las decisiones de §3 y §6 | Coincidencia con lo aprobado | Sólo lectura |

### 8.2 Validado manualmente

**Validación parcial local (2026-10-16).** La app se ejecutó contra Supabase local (`127.0.0.1:25435`) con cuentas y actividades ficticias, eliminadas al finalizar:

- Registro e inicio de sesión de organizadores; el acceso anónimo a `/panel` redirige a `/ingresar`.
- Aislamiento básico: la cuenta B no ve la actividad de A y el acceso directo al detalle de A devuelve 404. No se intentó una acción mutante como B.
- Moderación: una idea `pending` no aparece inicialmente en el muro; al aprobarla se presenta, al ocultarla sale del muro y al republicarla vuelve como destacada.
- Realtime: inserción y republicación se reflejan en el muro sin recargar. Se detectó que el filtro servidor por `activity_id` no entregaba eventos en el stack local; la suscripción quedó sin ese filtro y conserva la comprobación estricta de actividad en cliente. La actualización se observó en menos de 2 s.
- RPC `submit_idea`: resultado `accepted`, deduplicación `duplicate`, cinco aceptaciones por participante y actividad en 60 s, y `rate_limited` en la siguiente idea distinta.

Esta ejecución no valida FIFO bajo concurrencia, reconexión de red, volumen de más de 48 ideas, flujo visual completo del formulario, QR en celular, serialización HTML/RSC ni la matriz completa de permisos RLS.

**Validación T7/D4 (2026-10-16, posterior).** Contra el mismo Supabase local, en Chrome headless, se crearon dos actividades sintéticas (modos `automatic` y `approval`) y se envió una idea en cada una desde contexto anónimo:

- Modo `automatic`: el bloque de éxito mostró exactamente "¡Tu idea ya está en el muro!"; la idea quedó `status = published`, visible en el panel bajo "En el muro".
- Modo `approval`: mostró exactamente "¡Gracias! Tu idea quedó pendiente de aprobación."; la idea quedó `status = pending`, bajo "Por revisar" con botones de moderación.
- Coincidencia mensaje ↔ estado real verificada en el panel y por SQL de solo lectura; no apareció el texto erróneo "Está esperando su turno…".
- Evidencias (capturas de pantalla y JSON de pasos) en el directorio temporal fuera del repositorio: `C:\Users\lucas\AppData\Local\Temp\opencode\t7val\`. No se copiaron al repo.
- Datos sintéticos conservados (cuenta `org-t7val-…@synthetic.local`, actividades `PRUEBA-T7-AUTO-…` y `PRUEBA-T7-APPROVAL-…` con sus ideas). Sin cambios en producción ni sobre datos preexistentes.
- Limitaciones: Chrome headless local; sin pruebas en otros navegadores ni en dispositivo móvil. Cierra D4/T7; no valida A1 completa.

### 8.3 Pendiente de validación (lista de trabajo)

1. Ciclo completo: idea nueva → cola → featured (8 s) → transición (700 ms) → muro.
2. FIFO con ideas "simultáneas" (dos envíos casi juntos: orden predecible).
3. Límite visual: muro con >48 ideas publicadas → sólo 48 tarjetas, sin scroll creciente.
4. Moderación: ocultar desde el panel con idea en cola / destacada / muro → desaparición en ≤1 ciclo de resync (10 s) y retiro de la destacada.
5. Reconexión: cortar la red 30 s con ideas nuevas → al reconectar, todas aparecen (resync).
6. Recarga con `sessionStorage`: F5 durante una presentación → estado coherente (línea base en muro, posteriores al cursor en cola) y sin repetir lo ya presentado.
7. Primera apertura: sin presentar el histórico, sólo poblar el muro.
8. QR en dispositivo real: escanear desde el celular abierto vía LAN (`http://192.168.1.12:3000`) y verificar que el QR del panel y el del muro apuntan a un alcanzable desde el teléfono.
9. UX de envío en dispositivo: spinner, bloqueo del botón, mensaje de éxito/error, limpieza del textarea, preservación de identidad, contenido ante error.
10. Envíos dobles: presionar rápido / pre-hidratación → verificar que no se crean ideas duplicadas (ver D7).
11. Volumen: actividad con >1000 ideas → la query inicial no trunca en silencio (límite de PostgREST).
12. Refetch al recuperar foco: **no aplicable hasta implementarse** (D2).

---

## 9. Criterios de aceptación del MVP

Lista concreta y verificable. Todos están **pendientes de validación manual** salvo indicación.

| # | Criterio | Verificación esperada | Estado |
| --- | --- | --- | --- |
| A1 | **Envío** | Participante sin cuenta envía idea desde `/a/[code]`; ve "Enviando…" + spinner, botón bloqueado, y confirmación **del servidor**; textarea limpio, identidad conservada; ante error el contenido no se pierde. | Implementado · pendiente de validar manualmente |
| A2 | **FIFO** | Varias ideas seguidas se presentan en orden `(created_at, id)`, incluso llegadas simultáneas o fuera de orden por Realtime. | Implementado · pendiente de validar |
| A3 | **Concurrencia** | Envíos rápidos/simultáneos no duplican ni perdidos; el muro presenta todo lo publicado, en orden, sin duplicados visibles (dedup por `id`). | Implementado (dedup) · **punto abierto: duplicados de contenido en DB — D7** |
| A4 | **Presentación individual** | Cada idea publicada se muestra grande 8 s con barra de progreso y contador de espera, luego transiciona 700 ms. | Implementado · pendiente de validar |
| A5 | **Incorporación al muro** | Tras la transición la idea aparece en la grilla con su identidad visual (color/variante) **sin cambiar** la de las demás; el muro nunca supera 48 tarjetas. | Implementado · pendiente de validar |
| A6 | **Moderación** | Ocultar una idea la retira de cola/destacada/muro dentro de un ciclo; `pending` nunca llega al cliente público; DELETE retira al instante. | Implementado · pendiente de validar |
| A7 | **QR / LAN** | El QR y el enlace copiados desde el panel apuntan a un URL alcanzable desde el celular en la red local; escanear abre el formulario. | Implementado · pendiente de validar en dispositivo (D8) |
| A8 | **Recuperación ante reconexión** | Tras perder red ≥30 s, al reconectar: ideas perdidas entran a la cola y se presentan; no hay duplicados ni pérdidas. | Implementado · pendiente de validar |
| A9 | **Límite visual** | Con >48 ideas publicadas, el DOM muestra ≤48 tarjetas y la carga inicial no crece con el histórico. | Implementado · pendiente de validar con volumen |

Criterio transversal: el mensaje de éxito debe reflejar el estado real de la idea (publicada vs pendiente de aprobación) — **cumplido desde el cierre de D4/T7 (2026-10-16)**; la validación completa de A1 sigue pendiente.

---

## 10. Roadmap

### MVP / P0 — necesario para considerar el modelo completo

| Ítem | Estado |
| --- | --- |
| Máquina de estados cola → featured → transición → muro en el cliente del muro | ✅ Implementado (pendiente de validación manual) |
| `.limit(N)` + `slice(0,N)` (N=48) | ✅ Implementado |
| FIFO `(created_at, id)` ordenado al insertar | ✅ Implementado |
| Identidad visual por `idea.id` | ✅ Implementado |
| Delta refetch tras `SUBSCRIBED` (gap query inicial ↔ suscripción) | ✅ Implementado |
| Regla de recarga: "cola vacía al cargar; sólo las ideas nuevas se presentarán; lo posterior al cursor es elegible" | ✅ Implementado (codificado; falta comunicar/validar) |
| Transición CSS nativa (sin librerías) | ✅ Implementado (falta revisión visual en pantalla real) |
| UX de envío (spinner, bloqueo, confirmación real, contenido ante error) | ✅ Implementado |
| Correcciones de robustez P0 (§6) | ✅ Implementado |
| **Validación funcional manual del MVP** (§8.3, criterios A1-A9) | ⬜ **Pendiente — es la puerta de salida del P0** |
| **D4: mensaje de éxito correcto según estado de la idea** | ✅ Cerrado 2026-10-16 (T7; corregido en `idea-form.tsx` y validado en ambos modos, §8.2) |

### P1 — necesario para robustez (antes de un evento real)

| Ítem | Referencia |
| --- | --- |
| Refetch al recuperar la visibilidad de la pestaña (foco) | D2, evaluación A5 |
| Indicador de estado de conexión (EN VIVO / reconectando) vía callback de `subscribe` | evaluación P1.2 |
| Manejo explícito de errores en actions con fallo silencioso (3 actions) | evaluación P1.5 |
| Discrepancia D3: incorporar al repo la especificación de la cola o reetiquetar las referencias del código | trazabilidad |
| Discrepancia D6: actualizar `docs/arquitectura.md` con el modelo de presentación | evaluación P3.4 |
| Decisión sobre `docs/evaluacion-cola-de-presentacion.md` (actualizar encabezado / archivar / reemplazar) | D1 — **aún sin decidir, no se modificó** |

### P2 — escalabilidad y mejoras

Cursor de presentación compartido para múltiples pantallas sincronizadas (sólo si el producto lo exige) · paginación del panel sobre >1000 filas · `aria-live` adaptado al flujo de presentación · virtualización de la grilla si las métricas lo piden · política para colas muy grandes (acelerar vs indicador; nunca descartar).

### Fuera de alcance del MVP

Roles globales, votos, analítica, retención automática, PWA, librerías de animación, nueva infraestructura de tablas/servicios para la cola.

### Deuda técnica (P3)

Sin CI (`biome check` + `tsc --noEmit` + `next build`) · checks de ownership en 3 actions (RLS ya lo garantiza) · `allowedDevOrigins` sin configurar para desarrollo con origen LAN (assets 403 con `Origin` cross-origin).

---

## 11. Discrepancias encontradas (trazabilidad)

Se corrigieron las discrepancias D5 y D7 en la implementación; D4 se cerró el 2026-10-16 (T7, validado en local); D1–D3, D6 y D8 siguen abiertas. D9 describe el estado histórico anterior a los commits.

| # | Discrepancia | Realidad actual |
| --- | --- | --- |
| **D1** | `docs/evaluacion-cola-de-presentacion.md` declara en su encabezado **"Estado: Propuesta arquitectónica evaluable (no implementada)"**. | La propuesta está **parcialmente implementada** en el working tree (P0 completo + parte de P1: resync, single-flight, moderación por reconciliación). El encabezado está **desactualizado**. **No se modificó el archivo**; queda pendiente decidir si actualizarlo, archivarlo o reemplazarlo. |
| **D2** | La decisión A5 de la evaluación prevé refetch "al (re)conectar **y periódico/en foco**". | Sólo hay refetch al `SUBSCRIBED` y cada 10 s. **No existe** `visibilitychange`/refetch al recuperar foco (`live-wall.tsx` sin esas referencias). |
| **D3** | El código cita "Sección 8.2 / 10.1 / 11", invariantes `I4`, `I5`, `I7`, `I8`, `I9`, `CA-1`, `CA-11`, `H-03`. | Esas secciones e invariantes pertenecen al documento funcional *Modelo de presentación y cola de ideas*, **que no existe en el repo**. La trazabilidad del código queda rota. |
| **D4** | `submitIdeaAction` devuelve un mensaje diferenciado según `idea_status` ("¡Tu idea ya está en el muro!" vs "…pendiente de aprobación"), pero la UI reconstruía el texto en el cliente por subcadena (`includes("aprobaci")`) y mostraba siempre "Está esperando su turno para aparecer en el muro". | **Corregido y validado (2026-10-16, T7).** `idea-form.tsx:241` muestra ahora el `state.success` del servidor textualmente. Validado en local (Chrome headless): modo `automatic` → "¡Tu idea ya está en el muro!" + estado `published`; modo `approval` → "¡Gracias! Tu idea quedó pendiente de aprobación." + estado `pending`; panel y SQL coinciden (§8.2). Limitación: sin pruebas en otros navegadores ni dispositivos móviles. |
| **D5** | La evaluación clasifica el límite de ideas por participante (A8/P1.4) como **previo a exponer el muro en un evento real**. | Corregido: `submit_idea` limita a cinco aceptaciones por participante y actividad en 60 s; validado en Supabase local. Sigue pendiente evaluar si ese umbral es adecuado para un evento real. |
| **D6** | `docs/arquitectura.md` describe el muro como "actualización en vivo" sin cola, featured, transición ni límite de 48. | El documento no refleja el modelo actual (era P3.4; sigue pendiente). |
| **D7** | La RPC no tenía dedupe de contenido ni límite de envíos. | Corregido: `submit_idea` normaliza y deduplica contenido y aplica el límite documentado en D5; ambas respuestas se verificaron en Supabase local. La idempotencia de reintentos de transporte sigue sin estar garantizada. |
| **D8** | El QR/enlace depende del **origen del navegador** (`getBaseUrl()` por headers + `window.location.origin` en `share-qr-panel.tsx` y `live-wall.tsx:440`). | Coherente con la corrección aprobada (abrir el panel vía `http://192.168.1.12:3000`), pero **no probado con un celular real**; si el organizador abre el panel en `localhost`, el QR volverá a ser inalcanzable desde el teléfono. |
| **D9** | La evaluación registra como P3.1 "working tree sucio". | Estado histórico: los cambios de esta rama se registraron en commits; este texto queda como antecedente y no describe el estado actual del working tree. |

### Contradicciones adicionales detectadas

- **`initialJoinUrl` del muro es redundante:** el servidor calcula `initialJoinUrl` con `getBaseUrl()`, pero `live-wall.tsx:440` lo sobreescribe con `window.location.origin` al montar. El QR del muro termina usando el origen del navegador que lo muestra (coherente con D8, pero la prop del servidor sólo vive el primer render).
- **La evaluación ubica el delta refetch en P1, mientras que el código ya lo incluye en P0** (más allá de lo planificado en el documento, salvo el caso de foco, D2). Es una diferencia de estado, no de decisión.
- **`docs/despliegue.md` lista una comprobación manual de actividad de prueba** como paso de despliegue, pero no hay registro de su ejecución para el modelo de presentación.
- **La validación manual del modelo nuevo es parcial**, registrada en §8.2; los casos pendientes no deben considerarse aprobados.

---

## 12. Cómo mantener este documento

- Al implementar o validar cualquier ítem de §5, §8.3 o §9, actualizar su marca (**no** promover a "validado" sin evidencia manual).
- Las decisiones nuevas deben registrarse primero en su fuente (evaluación / conversación de definición) y luego aquí; **este documento no crea decisiones**.
- Cuando se cierre una discrepancia D1-D9, marcarla como resuelta con fecha y evidencia, sin reescribir el hecho histórico.
