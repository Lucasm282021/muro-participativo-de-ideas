# Plan de acción priorizado — Muro Participativo de Ideas

**Fecha:** 2026-10-12 · **Origen:** `docs/auditorias/2026-10-12-auditoria-general.md` · **Estado:** planificado; **ninguna tarea se ejecuta sin autorización previa del propietario.**

**Aviso R1 (condición de partida):** R1 está **aplicada en Supabase local** (política `activities` limitada a `anon`) y commiteada solo en `feat/pagina-administracion` (`c73fec7`), pero **NO está registrada en el historial local** `supabase_migrations.schema_migrations` ni **desplegada en producción** según la evidencia disponible (fuente: auditoría general C1/A1/A3).

**Tipo de operación de cada tarea** (etiquetas): `solo lectura` (L), `escritura local repo` (REPO), `escritura local BD/historial` (BD-LOCAL), `pruebas dinámicas` (PRUEBA), `cambios de código` (CODIGO), `intervención en producción` (PROD), `operación Git` (GIT). Nota: los artefactos de prueba (usuarios A/B y actividades `5CLOVMTD`, `TR00V5I3`, `PO7PSPPJ`) se conservan y **no deben limpiarse** sin orden expresa; `supabase db reset` local es destructivo de datos locales de prueba.

---

## P0 — Seguridad (bloqueante para publicar)

### T1 Registrar R1 en el historial local de migraciones
- **Operación:** BD-LOCAL (+ GRITAR decisión de estrategia).
- **Depende de:** nada.
- **Tarea:** consensuar estrategia (p. ej. `migration up --local` de una base recién reconstruida, o `migration repair --status applied`, o reconstrucción desde cero) para que `schema_migrations` registre `20261012142000`; **sin** `db push`/reset en esta tarea.
- **Criterios de aceptación:** `supabase_migrations.schema_migrations` contiene `20261012142000`; la política en `pg_policies` sigue siendo `anon` (estado requerido); el archivo sigue idempotente (`drop policy if exists` + `create policy`).
- **Verificación:** `L` consulta `SELECT version, name FROM supabase_migrations.schema_migrations` y `pg_policies`; comparar con historial de `main`.

### T2 Integrar `feat/pagina-administracion` a `main`
- **Operación:** GIT + REPO.
- **Depende de:** T1 (para que la rama lleve R1 ya registrada) y del cierre del working tree (B4) o su commit intencional.
- **Tarea:** revisar el diff vs `main` (incluye panel, config.toml con puertos locales, migración R1, docs generados si se incluyen); abrir/validar PR; merge a `main` cuando la revisión esté aprobada.
- **Criterios de aceptación:** `main` contiene la migración R1; puertos locales (`config.toml`) no afectan despliegue; el changelog documenta el merge; CI (si existe en esa altura) en verde.
- **Verificación:** `L` `git log main` + `git diff main...feat`; `GIT` push del merge; luego `PRUEBA` de despliegue de preview.

### T3 Aplicar la migración R1 a producción (Supabase remoto) + verificar
- **Operación:** PROD (+ L).
- **Depende de:** T2.
- **Tarea:** copia a mano de `docs/despliegue.md`: `npx supabase link --project-ref <ref>` (listado por el propietario), `npx supabase migration list` (revisión), `npx supabase db push` (confirmación). **Nunca** `db reset` contra producción.
- **Criterios de aceptación:** en producción, `activities` conserva RLS ON y la única política SELECT es sobre `anon` con `status IN ('open','closed')`; los grants de columna de `anon` no incluyen `owner_id`/`moderation_mode`; `schema_migrations` de prod contiene `20261012142000`.
- **Verificación:** `L` consultas `pg_policies`, `information_schema.role_column_grants`, `supabase_migrations.schema_migrations` contra el proyecto remoto (solo lectura, UI Studio o psql del proyecto).

### T4 Revalidar H-01 por HTTP autenticado post-R1 (extremo a extremo)
- **Operación:** PRUEBA + BD-LOCAL (crear cuenta/actividad de prueba) con límites.
- **Depende de:** T1 (historial coherente) y, para la réplica en prod, T3 (opcional: se puede ejecutar primero en local y luego repetir en prod).
- **Tarea:** con dos cuentas nuevas de contingencia (X, Y) y actividades (X propias; Y abierta y cerrada), repetir T2/T3: X leyendo las actividades de Y; anónimo leyendo campos públicos; anónimo solicitando `owner_id`.
- **Criterios de aceptación:** X recibe 200 con 0 filas para actividades de Y abierta y cerrada; anónimo sigue leyendo 1 fila (públicos); anónimo recibe 401/42501 al pedir `owner_id`. Repetido contra **producción** tras T3.
- **Verificación:** `PRUEBA` requests HTTP autenticados (acceso GoTrue + PostgREST), resultados registrados en un acta; `L` snapshot `pg_policies` antes/después.

---

## P0 — Integridad del producto

### T5 Defimir límite por participante/ventana y dedupe en `submit_idea` (P1.4 / D5 / D7)
- **Operación:** CODIGO (migración SQL) + BD-LOCAL + PRUEBA.
- **Depende de:** decisión del propietario sobre reglas (idea por participante/actividad o ventana de tiempo; política ante duplicado exacto).
- **Tarea:** implementar límite (p. ej. por `participants.email`+actividad con ventana) y dedupe/idempotencia dentro de `submit_idea` (mismo RPC `SECURITY DEFINER`), manteniendo `search_path=''` y permisos explícitos; documentar en `modelo-de-datos.md`/`arquitectura.md` (D6).
- **Criterios de aceptación:** N envíos rápidos del mismo participante quedan dentro del tope; envíos con contenido idéntico dentro de la ventana no insertan duplicados; el resto de flujos (moderación, automático) intactos; sin `service_role` expuesto.
- **Verificación:** `PRUEBA` de carga contra la RPC (10–30 envíos rápidos), revisar contador `ideas` y `participants`; `L` catálogo de función; re-corroborar con el criterio A3 del MVP (docs).

### T6 Reglas de cola grande / estado IDLE (decisión de producto)
- **Operación:** L (decisión/documentación).
- **Depende de:** propietario (11 decisiones funcionales de `evaluacion-cola:344-355`).
- **Tarea:** fijar y documentar reglas (nunca descartar ideas; ritmo tras recarga; política frente a >1000).
- **Criterios de aceptación:** documento funcional actualizado (elimina D1/D3) con las decisiones y su impacto.
- **Verificación:** `L` revisión del documento por el propietario; referencias cruzadas a `live-wall.tsx` actualizado.

---

## P1 — Funcional

### T7 Corregir mensaje de éxito según estado real (D4/M1)
- **Operación:** CODIGO.
- **Depende de:** nada.
- **Tarea:** en `idea-form.tsx` mapear el estado devuelto por `actions.ts:245-250` (publicado → "…ya está en el muro", pending → "pendiente de aprobación"); quitar la inferencia por subcadena.
- **Criterios de aceptación:** mensaje coherente en modo `automatic` (publicado) y `approval` (pendiente).
- **Verificación:** `PRUEBA` envío en ambos modos y lectura del mensaje en pantalla.

### T8 Resync al recuperar foco (D2/M2)
- **Operación:** CODIGO.
- **Depende de:** nada.
- **Tarea:** disparar `requestReconcile()` en `visibilitychange` (además de SUBSCRIBED + 60 s actuales en `live-wall.tsx:636-682`).
- **Criterios de aceptación:** tras >60 s fuera de pestaña, al volver el muro incorpora ideas nuevas y oculta moderadas en ≤1 pasada.
- **Verificación:** `PRUEBA` pestaña en segundo plano con envíos/ocultación, luego foco; observar actualización.

### T9 Error visible para el organizador + estados de carga/error globales (M5)
- **Operación:** CODIGO.
- **Depende de:** nada.
- **Tarea:** devolver `FormState` con error desde `toggleActivityAction`, `setModerationModeAction`, `moderateIdeaAction`; renderizarlos en la UI del panel; añadir `error.tsx`/`loading.tsx` apropiados.
- **Criterios de aceptación:** un fallo forzado (p. ej. red cortada o RLS) muestra mensaje al organizador; no hay fallos silenciosos con `console.error` únicamente.
- **Verificación:** `PRUEBA` inducir error y comprobar el mensaje visible.

### T10 QR/enlace en dispositivo real (D8/B2)
- **Operación:** PRUEBA.
- **Depende de:** nada (después del T0: verificar en local con red LAN o deploy preview).
- **Tarea:** escanear el QR y abrir `/a/[code]` desde un celular (misma LAN local o preview), enviar una idea y ver el muro en vivo; validar el flujo de "sin registro".
- **Criterios de aceptación:** QR y enlace funcionan sin los 403 de `allowedDevOrigins` (B3) (en preview no aplica; en LAN dev habrá que resolver B3).
- **Verificación:** `PRUEBA` en dispositivo; registrar resultado en la matriz A1-A9.

---

## P1 — Calidad y publicación

### T11 Poner el lint en verde + CI mínimo
- **Operación:** CODIGO + REPO.
- **Depende de:** nada.
- **Tarea:** resolver el único error de formato de `biome check` en `live-wall.tsx:781` (ternaria larga) y generar/activar un pipeline mínimo (`biome check`, `npx tsc --noEmit`, `next build`) en GitHub Actions; declarar scripts en `package.json` si hace falta.
- **Criterios de aceptación:** `npm run lint` exit 0; `npx tsc --noEmit` exit 0; `next build` exit 0; el pipeline corre sobre cada push/PR a `main`.
- **Verificación:** `L`/`PRUEBA` ejecución local de los tres comandos (sin escrituras fuera de `.next`/`tsbuildinfo` de artefacto) y observación del run en el repo tras push autorizado.

### T12 Resolver seed ausente (M8)
- **Operación:** REPO.
- **Depende de:** nada.
- **Tarea:** crear `supabase/seed.sql` (opciones: vacío con comentario, o datos de desarrollo) o fijar `[db.seed] enabled=false`; sincronizar con `despliegue.md`.
- **Criterios de aceptación:** `supabase db reset` local reconstruye completo (migraciones + seed + RLS) **en un entorno de prueba desechable** o tras respaldo de los artefactos de prueba; sin impacto en producción.
- **Verificación:** `PRUEBA` en una base local limpia y descartable (nunca en la BD local actual mientras se conserven los artefactos A/B), y `L` verificación de que `schema_migrations` queda en 3 versiones.

---

## P2 — Verificación funcional manual

### T13 Validación manual A1–A9 del MVP
- **Operación:** PRUEBA.
- **Depende de:** T7–T10 (para que los flujos probados sean los corregidos) y preferiblemente T11 (lint).
- **Tarea:** ejecutar los 12 ítems pendientes de `estado-actual:231-243` (ciclo FIFO completo, límite 48, moderación, reconexión/resync, recarga con cursor, primera apertura sin histórico, QR en dispositivo, UX de envío en dispositivo, envíos dobles, volumen >1000, foco tras T8, transición visual) y documentar resultados por criterio.
- **Criterios de aceptación:** matriz A1-A9 con resultado por ítem (aprobado/fallo + evidencia); D4 cerrado; sin fallos de bloqueo P0; registro en `docs/ficha-etapa-3-verificacion-funcional-y-matriz.md` o el documento equivalente.
- **Verificación:** `PRUEBA` manual + `L` revisión del registro por el propietario.

### T14 Recuperación de acceso de punta a punta
- **Operación:** PRUEBA (+ PROD-L config Auth solo lectura en preview).
- **Depende de:** T13.
- **Tarea:** flujo completo "olvidé mi contraseña" local con Inbucket (email, enlace, cambio, login); repetir en preview de Vercel verificando `Site URL`/URLs de retorno y dominios de Auth (M4).
- **Criterios de aceptación:** el enlace llegado por email lleva al cambio de contraseña exitoso; en preview se redirige al dominio correcto (sin `invalid_link`).
- **Verificación:** `PRUEBA` con cuentas de contingencia; `L` revisión de configuración Auth en el panel de Supabase (sin exponer claves).

---

## P3 — Operación (no bloqueante para la publicación controlada inicial)

### T15 Decisión de plan gratuito / pases / administración global
- **Operación:** L (decisión) → luego CODIGO si se aprueba.
- **Depende de:** propietario; nada técnico.
- **Tarea:** definir si el MVP publica sin límites (estado actual) o con plan/pases (requeriría diseño nuevo: tabla de planes, activación, vencimiento, billing, panel admin global). Documentar la decisión y ajustar `estado-actual`/`arquitectura`.
- **Criterios de aceptación:** decisión documentada y un enfoque acordado antes de cualquier promesa comercial.
- **Verificación:** `L` acta de decisión; cuando corresponda, plan técnico revisado.

### T16 Paginación del panel >1000 filas (M6)
- **Operación:** CODIGO.
- **Depende de:** T15 (volumen previsto).
- **Criterios de aceptación:** panel responde correctamente con >1000 actividades (UPDATED: consultas paginadas/cursor).
- **Verificación:** `PRUEBA` con dataset sintético local.

### T17 Actualizar documentación (D1/D3/D6) y commitear el working tree (B4)
- **Operación:** REPO/L (docs) + GIT (commit intencional autorizado).
- **Depende de:** cierre de fases previas; coordinar para no incluir archivos sin revisión.
- **Tarea:** alinear `docs/evaluacion-cola-de-presentacion.md`, `docs/arquitectura.md`, `docs/modelo-de-datos.md` con el estado real; commitear (autorizado) panel, `config.toml`, informes y checklist en el estado decidido.
- **Criterios de aceptación:** referencias D1/D3/D6 resueltas; el working tree queda limpio o con un plan aprobado.
- **Verificación:** `L` revisión de docs por el propietario; `L` `git status` limpio/plan aprobado.

### T18 (Opcional) Habilitar `allowedDevOrigins` para LAN dev (B3)
- **Operación:** CODIGO/REPO.
- **Depende de:** T10 si se verifica en LAN.
- **Criterios de aceptación:** assets `/_next/*` cargan desde IPs de LAN durante `next dev`.
- **Verificación:** `PRUEBA` en red local.

---

## Dependencias globales

```
T1 → T2 → T3 → T4 (cierre H-01 extremo a extremo, local y prod)
T1/T2/T3 → publicación (gate C1/A1/A3)
T5/T6 → evento real (gate A2)
T11/T12 → entorno reproducible (gate M7/M8)
T7→T10 y T13/T14 → validación funcional A1-A9 (gate P0 funcional)
T15..T18 → operación (post-publicación, opcional)
```

## Reglas de ejecución
- Ninguna tarea se ejecuta sin autorización previa del propietario; las tareas marcadas `PROD`, `GIT` o destructivas (`BD-LOCAL` con `db reset`) requieren autorización explícita adicional.
- `supabase db reset` solo sobre entornos desechables; nunca sobre la BD local actual mientras se conserven los artefactos de prueba A/B, ni contra producción.
- Toda prueba con datos anexos debe basarse en cuentas/actividades de contingencia y registrarse en el acta o matriz correspondiente, sin limpiar artefactos sin orden.