# Estado actual del producto — Muro Participativo de Ideas ("muro común")

**Fecha de consolidación:** 01/11/2026
**Rama autorizada:** `Dev` · **HEAD local:** `dbc2f356bb6fe2f8906590652a5351e446a6db8b`
**Propósito:** Fuente de verdad única sobre qué producto estamos construyendo, qué decisiones están aprobadas, qué está implementado, qué está validado, qué incertidumbres existen y qué falta para producción.
**Alcance de este documento:** Producto, arquitectura y gobernanza técnica.
**Fuentes primarias:** Implementación real del repositorio en `Dev`, migraciones SQL en `supabase/migrations/`, suite de pruebas en `tests/`, y evidencias de las auditorías técnicas 14O y 14P.

---

## 1. Propósito del producto

### Problema que resuelve
En un evento, taller o reunión, las ideas de los participantes suelen dispersarse: se anotan en papeles que nadie sistematiza, se expresan oralmente y se olvidan, o quedan atrapadas en un chat secundario. No existe un punto de encuentro unificado donde la voz de todos sea visible, ordenada y compartida de manera equitativa.

### Experiencia que busca generar
- El participante, **sin crear cuenta**, escribe su propuesta desde el celular (vía enlace o código QR) y recibe confirmación inmediata de recepción.
- La pantalla colectiva (proyector o monitor grande) **le da protagonismo individual a cada idea**: una por vez, en orden cronológico de llegada, con su momento exclusivo de atención.
- Cumplido el tiempo de protagonismo, la idea **se integra orgánicamente al muro colectivo**: un mosaico armónico que presenta la conversación completa sin saturar la pantalla.
- El organizador administra (crea, modera, cierra, exporta y elimina) sin requerir intervención manual durante la proyección en vivo.

### Principio rector
> **"Enviar no es lo mismo que aparecer."**
> El flujo funcional transita por fases estrictas: `Enviar → Cola FIFO → Presentación destacada (Featured) → Transición → Muro armónico`.

---

## 2. Modelo funcional

```text
Enviar → Cola FIFO → Presentación destacada (Featured) → Transición → Muro armónico
```

| Etapa | Comportamiento en la implementación |
| :--- | :--- |
| **Enviar** | El participante envía nombre, apellido, correo e idea desde `/a/[code]`. Server Action valida con Zod y delega a la RPC `submit_idea`. Se persiste de forma atómica en PostgreSQL con estado `pending` o `published` y número correlativo asignado. |
| **Cola FIFO** | En la pantalla del muro, las ideas aprobadas ingresan a una cola FIFO local en memoria. La cola es estrictamente ordenada por `(created_at ASC, id ASC)` y nunca descarta elementos. |
| **Presentación destacada** | La cabeza de la cola se proyecta como tarjeta destacada (*Featured*) durante **8 segundos** (`hold=8s`), acompañada de una barra de progreso y el contador "+N en espera". |
| **Transición** | Fase visual intermedia de **700 ms** (`transitioning`) en la que la tarjeta se traslada hacia su posición en el mosaico. |
| **Muro armónico** | La idea se incorpora a la grilla adaptativa de hasta **48 tarjetas visibles simultáneas** (`N=48`). Las ideas excedentes salen del DOM, manteniéndose preservadas en la base de datos. |

---

## 3. Decisiones funcionales y técnicas aprobadas (Vigentes)

| # | Decisión | Estado en código | Referencia técnica |
| :-: | :--- | :---: | :--- |
| 1 | **Cola local por pantalla** (cada instancia del muro presenta a su ritmo) | ✅ Implementada | Estado React por instancia en `src/components/live-wall.tsx` |
| 2 | **FIFO determinista `(created_at, id)`** | ✅ Implementada | `compareIdeasFIFO`, `src/lib/presentation.ts:44` |
| 3 | **Límite visual de 48 tarjetas (`N=48`)** | ✅ Implementada | `MAX_WALL_CARDS`, `src/lib/presentation.ts:3` |
| 4 | **Duración de destacada (`hold = 8s`)** | ✅ Implementada | `HOLD_DURATION_MS`, `src/lib/presentation.ts:4` |
| 5 | **Duración de transición (`700 ms`)** | ✅ Implementada | `TRANSITION_DURATION_MS`, `src/lib/presentation.ts:5` |
| 6 | **Procesamiento por batches (`CAP = 100`) sin descartar** | ✅ Implementada | `BATCH_CAP`, `src/lib/presentation.ts:115` |
| 7 | **Apertura inicial sin catch-up histórico** (ideas previas pueblan el muro directo) | ✅ Implementada | `src/components/live-wall.tsx:443` |
| 8 | **Cursor monótono `{createdAt, id}`** | ✅ Implementada | Tipo `Cursor`, `maxCursor`, `src/lib/presentation.ts:17` |
| 9 | **Reconciliación y resync periódico** | ⚠️ Parcial | Intervalo y reconexión en `live-wall.tsx` (con reserva por §4.1) |
| 10 | **Persistencia de cursor en `sessionStorage`** | ✅ Implementada | `muro_cursor2_<CÓDIGO>`, `src/lib/presentation.ts:237` |
| 11 | **Identidad cromática de tarjeta por hash de `id`** | ✅ Implementada | `getCardVariant`, `src/lib/presentation.ts:32` |
| 12 | **Moderación reactiva con interrupción de destacada** | ✅ Implementada | `purgeModeratedIdeas` y Realtime en `live-wall.tsx` |
| 13 | **Numeración correlativa atómica por actividad** | ✅ Implementada | Trigger `assign_idea_number`, campo `idea_number` en `ideas` |
| 14 | **Grilla armónica híbrida de llenado progresivo** | ✅ Implementada | Algoritmo adaptativo en `live-wall.tsx`, 12/12 tests pasando |
| 15 | **Distribución vertical Flexbox y scroll completo en panel** | ✅ Implementada | Commit `dbc2f35`, eliminación de Grid obsoleto y candado `100vh` |
| 16 | **Exportación atómica en formatos CSV y HTML interactivo** | ✅ Implementada | Route Handler `/panel/actividad/[id]/exportar` |
| 17 | **Supervisión y auditoría administrativa global (`/admin`)** | ⚠️ Apto con reservas | Tabla `admin_global`, bitácora `audit_logs` con `contract_version=2` |

---

## 4. Hallazgos críticos, incertidumbres y defectos abiertos

### 4.1. Defecto de numeración correlativa en cliente anónimo
1. **Permiso de columna omitido:** La migración `20261028150000` agregó la columna `idea_number` a `public.ideas`, pero omitió otorgar `GRANT SELECT (idea_number) ON public.ideas TO anon;`. Las consultas directas ejecutadas por clientes sin autenticar fallarán si intentan leer la columna de forma directa.
2. **Omisión en reconexión (*catch-up*):** En `src/components/live-wall.tsx`, las consultas de recuperación y descubrimiento omiten `idea_number` en la proyección `.select()`, ocasionando que las ideas reconectadas carguen con número no definido en el estado local.

### 4.2. Discrepancia no resuelta de dominios de producción
- Existen dos dominios productivos citados en el repositorio: `https://murocomun.vercel.app` y `https://muro-participativo-de-ideas.vercel.app`, junto a la URL de preview `https://muro-participativo-de-ideas-aw6gfa7p9-kritio-systems.vercel.app`.
- **Estado formal:** **PENDIENTE DE CONFIRMACIÓN.** Queda expresamente prohibido elegir uno sin verificación fehaciente en la infraestructura de Vercel y Supabase.

### 4.3. Estado de migraciones en producción
- Las migraciones `1` a `7` están verificadas en producción.
- Las migraciones `20261021140000_audit_cascade_counts_v2.sql`, `20261028150000_ideas_atomic_numbering.sql` y `20261029170000_export_activity_ideas_rpc.sql` se encuentran aplicadas en la base de datos local, pero su aplicación en producción es **ESTRICTAMENTE DESCONOCIDA** (sin telemetría).
- La migración `20261029170000` fue aplicada localmente sin constancia documental de autorización previa.

### 4.4. Estado de pruebas, lint y compilación
- **TypeScript:** 0 errores (`npx tsc --noEmit`).
- **Pruebas automatizadas:** 54/54 pruebas estáticas registradas formalmente en la auditoría 14O y 12 pruebas geométricas adicionales informadas posteriormente para la grilla híbrida (totalizando 77 tests en la corrida global reportada: 72 aprobados, 2 fallidos por condiciones de entorno y 3 omitidos). No se computan los conjuntos de 54 y 12 como 66 estáticas independientes al no haberse verificado exhaustivamente la ausencia de solapamientos entre las aserciones de cada archivo; se presentan ambos conteos por separado. Las pruebas dinámicas de administración requieren entorno desechable aprovisionado formalmente (AU-4C).
- **Biome (`npm run lint`):** Falla en formato por incluir carpetas de respaldo y diferencias CRLF en 9 archivos preexistentes.
- **Compilación de producción:** Requiere `npx next build --webpack` en Windows debido a limitaciones de Turbopack en rutas con espacios.

---

## 5. Calificación integral del producto

| Subsistema | Calificación | Justificación |
| :--- | :---: | :--- |
| **Muro público (`/muro/[code]`)** | **APTO CON RESERVAS** | Grilla y cola operativas; reserva por defecto de `idea_number` para `anon`. |
| **Panel de actividad (`/panel/actividad/[id]`)** | **APTO** | Parche Flexbox validado visualmente en 6 viewports; scroll completo. |
| **Módulo de exportación** | **APTO CON RESERVAS** | Apto en código y pruebas disponibles; su habilitación en producción permanece condicionada a la verificación y autorización formal de la migración 20261029170000 y de la disponibilidad de su RPC en producción. |
| **Panel de administración global (`/admin`)** | **APTO CON RESERVAS** | RLS y auditoría V2 listas; pendiente prueba dinámica en contenedor. |
| **Infraestructura de base de datos** | **NO APTO PARA PRODUCCIÓN DIRECTA** | Incertidumbre sobre migraciones 8, 9 y 10 en producción. |

---

## 6. Procedimiento para retomar el desarrollo

1. **Ubicación obligatoria:** Trabajar únicamente en la raíz física oficial:
   `C:\Users\lucas\Desktop\Proyectos de 2026\Muro Partisiativo de Ideas`
2. **Confirmar estado Git antes de cualquier acción:**
   `git branch --show-current` (`Dev`), `git rev-parse HEAD` (`dbc2f35...`).
3. **Preservar archivos preexistentes:** No alterar los 9 archivos CRLF stat-dirty ni los 7 elementos untracked.
4. **Próximos pasos técnicos autorizados:**
   - Realizar push controlado de `dbc2f35` hacia `origin/Dev`.
   - Subsanar el grant de `idea_number` para `anon` y la proyección de catch-up (Etapa 15A).
   - Auditar el estado de migraciones en la base de datos de producción mediante `npx supabase migration list`.
