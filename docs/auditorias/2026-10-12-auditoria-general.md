# Auditoría general — Muro Participativo de Ideas

**Fecha:** 2026-10-12 · **Alcance:** solo lectura (estática + comprobaciones dinámicas de inspección: `biome check .` y `SELECT` a catálogo local). Ninguna escritura, migración, despliegue ni operación de Git de mutación. Entorno local Supabase: DB `127.0.0.1:25433`, API `127.0.0.1:25435`; `NEXT_PUBLIC_SUPABASE_URL` local en `.env.local`.

**Aviso R1 (estado de la evidencia):** R1 está **aplicada en Supabase local** (política `activities` limitada a `anon`) y commiteada solo en la rama `feat/pagina-administracion` (`c73fec7`), pero **NO está registrada en el historial local** `supabase_migrations.schema_migrations` ni **desplegada en producción** según la evidencia disponible en este repositorio (`main`/`develop` no contienen el archivo de migración).

---

## 1. Resumen ejecutivo y estado general

- Rama activa **`feat/pagina-administracion`** (HEAD `c73fec7` = "fix: restringir lectura publica de actividades al rol anon (R1/H-01)"). `main` y `develop` no contienen el archivo de migración R1.
- **El MVP está funcionalmente completo en código** (registro/login/recuperación, panel del organizador con moderación, envío de ideas vía RPC, muro público con realtime + cola de presentación) y se verificó tecnológicamente en sesiones anteriores (tsc/build/biome con 0 errores, `docs/estado-actual-del-producto.md:208-224`), pero presenta deuda identificada (D1–D9) y **ninguna validación manual A1–A9 registrada** (`estado-actual:227,231-243`).
- **Seguridad:** RLS y permisos de la base local correctos y re-verificados por `SELECT` a catálogo; la corrección **H-01/R1 está aplicada en local y confirmada a nivel SQL/RLS (T6)**, pero **falta la repetición HTTP autenticada post-R1** y R1 **no está en el historial de migraciones ni en `main`/producción**.
- **Hoy mismo** el lint **falla** (1 error de formato en `live-wall.tsx:781`).
- **Monetización/plan gratuito/pases/admin global: no existen** en código ni base de datos.
- **Veredicto de publicación controlada: NO está listo en este estado.** Hay pasos bloqueantes de seguridad (R1 → main/prod + revalidación HTTP) y de integridad (anti-spam, validación manual, CI/lint).

## 2. Hallazgos por severidad

### CRÍTICA
- **C1 — R1 solo existe en local y en la rama `feat`; `main`/producción no la tienen.** El archivo `supabase/migrations/20261012142000_restrict_activities_read_to_anon.sql` existe solo en el working tree/rama actual (`git cat-file -e main:…` → no existe; igual `develop`). El despliegue de producción ocurre por `main` (`docs/despliegue.md:6`). Riesgo: publicar el MVP y que producción conserve la política vulnerable (`anon,authenticated`) de la fase H-01.

### ALTA
- **A1 — Prueba HTTP autenticada post-R1 pendiente.** R1 verificada solo a nivel SQL/RLS (T6 y catálogo); no se re-ejecutó T2/T3 por HTTP (GoTrue→PostgREST) tras el cambio.
- **A2 — Sin límite por participante, sin rate-limit ni dedupe en `submit_idea`** (D5/D7). RPC `SECURITY DEFINER` volátil sin control; duplicados reales documentados ("Prueba 1"×12 en 11 s, dos escrituras a 153 ms — `estado-actual:323`; riesgo spam/abuso y "secuestro del proyector" — `evaluacion-cola:424-432`, `265-280`).
- **A3 — Estado real de la base de producción no verificado** (políticas, migraciones aplicadas, variables Vercel, Site URL/URLs de retorno Auth). No está probado que producción replique el esquema correcto; las migraciones se aplican manualmente (`despliegue.md:55-57`).

### MEDIA
- **M1 — Mensaje de éxito (D4)**: el servidor distingue publicado vs pendiente (`actions.ts:245-250`), pero la UI mapea cualquier texto sin "aprobaci" a *"Está esperando su turno para aparecer en el muro"* (`idea-form.tsx:241-244`) → una idea publicada al instante se anuncia como "esperando turno".
- **M2 — Sin resync al recuperar foco** (D2): solo hay resync en `SUBSCRIBED` y cada 60 s (`live-wall.tsx:661-669`); sin listener de `visibilitychange`.
- **M3 — Documentación desactualizada/inconexa** (D1, D3, D6): `evaluacion-cola-de-presentacion.md:4` dice "no implementada" (ya está implementada parcialmente); referencias a I4-I9/CA-1/H-03 sin documento funcional en el repo; `docs/arquitectura.md` no refleja el modelo de presentación.
- **M4 — Flujo de recuperación/confirmación no verificado end-to-end**; local usa confirmación desactivada (`README.md:56`) y no se probó el email real (Inbucket); en producción con confirmación activada, `Site URL`/`redirectTo` mal configurados rompen el callback (`despliegue.md:25-35`).
- **M5 — Errores silenciosos en 3 Server Actions** (`moderateIdeaAction`, `setModerationModeAction`, `toggleActivityAction`): fallan con `console.error` + `throw` sin feedback de UI (`actions.ts:290-293,303-306,333,374-377,435-438,461`); no hay `error.tsx`/`loading.tsx` globales.
- **M6 — Paginación ausente en el panel (>1000 filas)**; PostgREST trunca en 1000 (`evaluacion-cola:20-23`), pendiente de P2.
- **M7 — `biome check .` FALLA hoy** (1 error de formato en `live-wall.tsx:781`); sin CI en el repo (`estado-actual:305`).
- **M8 — Seed configurado pero ausente**: `supabase/config.toml:67-72` define `[db.seed] enabled=true` con `sql_paths=["./seed.sql"]` y **no existe `seed.sql`** → `supabase db reset` local fallaría en el paso de seed.

### BAJA
- **B1 — Enumeración de cuentas**: `signUpAction` responde "Ya existe una cuenta con ese email" (`actions.ts:59-63`); mitigado por rate-limit de GoTrue.
- **B2 — QR/enlace sin prueba en celular real** (D8); depende del origen del navegador (`share-qr-panel.tsx:27-32`).
- **B3 — `allowedDevOrigins` sin configurar** → assets `/_next/*` cross-origin dan 403 en LAN dev (`estado-actual:222`); solo desarrollo.
- **B4 — Working tree sucio** (D9): 2 archivos de panel + `config.toml` modificados, 2 carpetas untracked.
- **B5 — Sin PWA/manifiesto/service worker** (fuera de alcance, `estado-actual:159`).

## 3. Evidencia concreta

**Seguridad (RLS/permisos — re-verificado por `SELECT` en catálogo local):**
- `activities`: RLS ON; tras R1 sola política SELECT `Anyone can read open or closed activity details` → rol `anon`, `USING status IN ('open','closed')`. `authenticated`: SELECT/INSERT/UPDATE/DELETE con `owner_id = auth.uid()`; INSERT con `WITH CHECK (owner_id = auth.uid())`. Coincide con migración (`20261002080804:79-131` + R1 `20261012142000:7`).
- `ideas`: SELECT pública solo `status='published'` para actividades abiertas/cerradas a `anon,authenticated` (contenido público por diseño); UPDATE/DELETE de organizadores de la propia actividad; sin INSERT (solo vía RPC). Triggers `ideas_set_initial_status`, `ideas_update_published_at`.
- `idea_authors`/`participants`: solo SELECT para `authenticated` (organizador propietario).
- Grants de columna: `anon` sin `owner_id` ni `moderation_mode` en `activities` (migración:87-96,152-154). T4b (informe cierre H-01) demostró que esa limitación es por **permisos de columna**, no RLS.
- RPC `submit_idea`: `SECURITY DEFINER`, `volatile`, `search_path=''` (`20261002120000:12,62-64`); sin `service_role` en `src` (grep 0); `.env.local` ignorado (`.gitignore:34-35`); sin `dangerouslySetInnerHTML`/`eval` (grep 0); validación Zod en todas las actions (`actions.ts:13-19,157-161,208-217,253-259,339-344,400-405,472`); guard anti-open-redirect en `/auth/callback` (`route.ts:7-10`).

**Migraciones/BD:** historial `schema_migrations` = solo `20261002080804` y `20261002120000` (SELECT re-verificado); R1 **no registrada**. Diferencia entre historial y estado real (informe H-01, sección 6).

**Funcionalidad:** flujos en `actions.ts`, `auth-form.tsx`, `activity-form.tsx`, `idea-form.tsx`, `share-qr-panel.tsx`, `delete-activity-button.tsx`, `live-wall.tsx` (realtime 636-682; moderación acotada a 49 IDs 418-437; verificación del candidato antes de promover 307-338), páginas `/panel`, `/panel/actividad/[id]`, `/a/[code]`, `/muro/[code]`.

**Calidad/publicación:** `package.json` (Next 16.3.8, React 19.2.8, Zod 4.6.5, qrcode.react 4.2.0, Biome 2.5.15, CLI Supabase 2.119.0); `tsconfig strict`; `next.config.ts` vacío (sin `allowedDevOrigins`); `globals.css` con 6 breakpoints responsivos (1768/1828/1886/1905/1975/1987) y `prefers-reduced-motion` (2370); a11y básica (aria-live en muro 725, roles alert/status, sr-only, aria-busy). Accesibilidad P2 pendiente.

## 4. Corregido · Pendiente · No verificado

**Corregido:** H-01 mitigada en local (R1 aplicada + T6: aislamiento entre cuentas y lectura pública conservada; informe H-01); RLS/grants/triggers/RPC consistentes entre migración y BD local; sin secretos en repo/código; `owner_id` explícito en consultas del panel (working tree: `panel/page.tsx:18`, `panel/actividad/[id]/page.tsx:28`).

**Pendiente:** registrar R1 y llevarla a `main`+prod (C1); revalidar HTTP post-R1 (A1); anti-spam/límite en RPC (A2, P1.4); D4 (M1), D2 (M2), D1/D3/D6 (M3), D8 (B2), D9 (B4); seed.sql (M8); lint actual (M7); validación manual A1-A9; free-plan/pases/admin (no implementado).

**No verificado (en esta fase):** `next build` y `tsc` actuales (no ejecutados; evidencia previa `estado-actual:208-216`); RLS/migraciones/variables y Auth de **producción**; comportamiento en navegador (cola, transiciones, multi-pantalla, QR celular); flujo real de recuperación de acceso; foco (D2) hasta implementarse.

## 5. Riesgos de seguridad y datos

- **Datos:** publicar sin R1 en prod = fuga de metadatos de actividades ajenas y `owner_id` (H-01). Datos personales de participantes protegidos por RLS solo si el esquema de prod replica las migraciones.
- **Disponibilidad/abuso:** `submit_idea` público sin límites (A2): spam, colas amplificadas, registro del muro por volumen.
- **Confidencialidad:** sin fugas encontradas en código (validaciones, sin `innerHTML`, callback seguro). Moderación oculta una idea pero persiste en muro/cola hasta refetch (limitación conocida).
- **Continuidad:** historial de migraciones incoherente (R1 aplicada fuera de registro); reintento de R1 es idempotente, pero `db push` podría pulsar un esquema distinto al esperado en prod.

## 6. Matriz de funcionalidades

| Función | Estado | Evidencia |
|---|---|---|
| Registro / inicio de sesión | Implementado (login probado; registro no re-testeado hoy) | `auth-form.tsx`, `actions.ts:21-81` |
| Recuperación de acceso | Implementado · no verificado end-to-end | `actions.ts:83-149`, callback |
| Creación de actividades | Implementado · probado en tests H-01 | `activity-form.tsx`, Fase B |
| Gestión de actividades (cerrar/reabrir/eliminar/modo/moderar) | Implementado · cierre probado (lectura) | `share-qr-panel`, `delete-activity-button`, `actions.ts:253-466`; RLS verificada |
| Participación y envío de ideas | Implementado · RPC verificado en catálogo y medición documentada; sin prueba de escritura hoy | `idea-form.tsx`, `submit_idea` RPC |
| Muro público + actualización en vivo | Implementado · validación manual A1-A9 pendiente | `live-wall.tsx` |
| Cierre de actividades / permisos organizador | Implementado (aislamiento T6; HTTP post-R1 pendiente) | informe H-01 |
| Paneles / navegación / estados vacíos | Implementado; errores globales ausentes (M5) | `page.tsx`, panel, `empty-wall` |
| Free plan / pases / activación / vencimiento / pagos | **Ausente** | grep 0; docs sin mención |
| Administración global | **Ausente** (explicitado) | `arquitectura.md:78`, `estado-actual:159` |
| PWA / instalable | Ausente (fuera de alcance) | `estado-actual:159` |
| Votos / analítica de moderación | Ausente (fase 2) | `modelo-de-datos.md:80` |

## 7. Evaluación de preparación para publicar

**No listo** para publicación controlada. Bloqueantes: C1 (R1 a `main`+prod y verificación de prod), A1 (revalidación HTTP post-R1), A2 (límites anti-spam) y cierre de la validación funcional manual A1–A9. Habilitante: gate de lint en verde (M7) y resolución de M8 antes de tocar el entorno con `db reset`. No implica cambios de código grandes; sí despliegues y pruebas controladas.

## 8. Plan de acción priorizado (con dependencias)

1. **P0-Seguridad (bloqueante):** [B]registrar R1 en el historial → [D]merge de `feat/pagina-administracion` a `main` → [D]`supabase link`+`migration list`+`db push` (revisión) → [D]re-verificar políticas/grants en prod → [P]re-ejecutar T2/T3 HTTP autenticado post-R1 (nueva cuenta) → liberar H-01.
2. **P0-Integridad:** anti-abuso en `submit_idea` (límite por participante/ventana + dedupe; P1.4) → reglas de cola vacía/IDLE.
3. **P1-Funcional:** D4 (mensaje por estado real), D2 (foco), errores con feedback (M5), `error.tsx`.
4. **P1-Calidad:** resolver error de Biome (M7) y añadir CI mínimo (`biome`+`tsc --noEmit`+`next build`); seed.sql o `enabled=false` (M8).
5. **P2-Verificación:** plan y ejecución de validación manual A1-A9 (12 ítems, `estado-actual:231-243`) + QR en celular (D8/B2).
6. **P3-Op:** decisión free plan/pases/admin global previa a promesas comerciales; paginación >1000 (M6); actualizar docs D1/D3/D6; commitear working tree (B4).

Dependencias: (1) precede a cualquier publicación; (2) precede al evento real; la validación (5) conviene tras lint en verde.

## 9. Pruebas recomendadas por corrección

- **C1/R1 en prod:** tras `db push`, repetir T1–T5 y T4/T4b contra **producción** con dos cuentas (aislamiento + lectura pública + `owner_id` negada a anon) y verificar `pg_policies`/`schema_migrations` en prod.
- **A1:** re-ejecutar T2/T3 autenticado post-R1 y confirmar 200 con 0 filas para actividades ajenas.
- **A2/D7:** pruebas de carga contra `submit_idea` (N envíos rápidos de un participante; contenido idéntico repetido) verificando límite e idempotencia.
- **M1:** envío en modo `automatic` → "…ya está en el muro"; en `approval` → "pendiente de aprobación".
- **M2:** cambiar de pestaña y volver tras >60 s y tras eventos fuera de pestaña → el muro incorpora lo nuevo y modera ocultadas.
- **M5:** forzar fallo en moderar/cerrar/eliminar → el panel muestra error.
- **M7/M8:** `npm run lint` en CI (0 errores) y `supabase db reset` local completo en base limpia de prueba.
- **M4:** recuperación de contraseña de punta a punta con Inbucket; en preview de Vercel verificar callback con dominio del preview en Site URL.

---

**Nota de método:** observaciones estáticas = lectura de código/migraciones/docs + git; pruebas dinámicas de esta sesión = `biome check .` (1 error) y `SELECT` de catálogo/permisos/historial (sin escrituras); resultados H-01 (T1–T6) provienen del cierre previo (`docs/auditorias/2026-10-12-cierre-h01-r1.md`).