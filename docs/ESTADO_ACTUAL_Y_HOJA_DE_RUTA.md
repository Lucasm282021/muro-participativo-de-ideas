# Estado Actual y Hoja de Ruta — Muro Participativo de Ideas ("muro común")

**Fecha de consolidación:** 01/11/2026
**Rama de trabajo autorizada:** `Dev`
**HEAD local actual:** `dbc2f356bb6fe2f8906590652a5351e446a6db8b`
**Propósito:** Documento maestro de consolidación técnica, funcional, operativa y de continuidad para que cualquier desarrollador o auditor pueda retomar el proyecto sin depender del historial de conversaciones ni asumir estados no verificados.

---

## 1. Identificación y Propósito del Proyecto

### 1.1. Qué es el producto
**Muro Participativo de Ideas** ("muro común") es una aplicación web colaborativa orientada a eventos presenciales, talleres y reuniones. Su objetivo es democratizar la participación y dar visibilidad ordenada a las ideas de los asistentes.

### 1.2. Principio rector de experiencia
> **"Enviar no es lo mismo que aparecer."**

El flujo funcional desacopla la recepción del contenido de su proyección pública:
1. **Envío móvil:** El participante accede desde su celular (vía enlace corto o escaneo de código QR), sin necesidad de crear cuenta, completando nombre, apellido, correo electrónico y su idea (hasta 500 caracteres).
2. **Recepción y persistencia:** La Server Action valida los datos y delega la inserción a la base de datos vía la RPC `submit_idea`, que opera bajo una transacción atómica asignando estado `published` (en modalidad automática) o `pending` (en modalidad con revisión previa).
3. **Cola de presentación FIFO:** Las ideas aprobadas son recibidas en el muro público vía Supabase Realtime y encoladas en memoria bajo orden determinista `(created_at ASC, id ASC)`.
4. **Presentación destacada (*Featured*):** Cada idea ocupa la pantalla grande durante 8 segundos (`hold=8s`) de manera individual, con barra de progreso y contador de espera.
5. **Transición:** Durante 700 ms la tarjeta se traslada hacia el mosaico colectivo.
6. **Muro colectivo (*Wall*):** La idea pasa a formar parte de una grilla armónica que conserva hasta 48 tarjetas visibles simultáneamente en pantalla, mientras la base de datos almacena el histórico íntegro.

---

## 2. Arquitectura Vigente

### 2.1. Topología del sistema
```mermaid
flowchart LR
    BrowserPart[Participante móvil<br/>Sin autenticación] -->|HTTPS POST| NextServer[Next.js App Router<br/>Server Actions / RPC]
    BrowserWall[Muro público / Pantalla grande] -->|HTTPS GET + Realtime WS| Supabase[Supabase Managed Cloud]
    BrowserOrg[Organizador / Administrador] -->|HTTPS + Cookies Auth| NextServer
    NextServer -->|@supabase/ssr + Publishable Key| Supabase
    Supabase --> PostgreSQL[(PostgreSQL + RLS)]
```

- **Frontend y BFF:** Next.js 16.3.8 (App Router), React 19, TypeScript 5.
- **Backend as a Service:** Supabase (PostgreSQL 15+, Supabase Auth con sesiones SSR en cookies seguras, Supabase Realtime mediante WebSockets).
- **Hosting de aplicación:** Vercel (despliegues vinculados al repositorio GitHub `Lucasm282021/muro-participativo-de-ideas`).
- **Seguridad en datos:** Row Level Security (RLS) mandatorio en todas las tablas, funciones con `SECURITY DEFINER` y `set search_path = ''` para mitigar vulnerabilidades CWE-426.

### 2.2. Superficie de rutas de la aplicación

| Ruta | Acceso | Responsabilidad |
| :--- | :--- | :--- |
| `/` | Público | Portada institucional y acceso a autenticación. |
| `/crear-cuenta` | Público | Registro de organizadores (Supabase Auth). |
| `/ingresar` | Público | Inicio de sesión con correo y contraseña. |
| `/recuperar-contrasena` | Público | Solicitud de correo de recuperación. |
| `/auth/callback` | Público | Intercambio de tokens de autenticación / recuperación. |
| `/restablecer-contrasena` | Autenticado temporal | Establecimiento de nueva clave con sesión de recuperación. |
| `/panel` | Autenticado (Organizador) | Listado y creación de actividades del propietario. |
| `/panel/actividad/[id]` | Autenticado (Propietario) | Detalle de actividad: QR, moderación de ideas, cambio de modalidad, lista de participantes y eliminación. |
| `/panel/actividad/[id]/exportar` | Autenticado (Propietario) | Descarga estructurada de ideas en formatos CSV y HTML interactivo (*Slide Deck*). |
| `/a/[code]` | Público | Formulario móvil de participación y envío de ideas. |
| `/muro/[code]` | Público | Proyección en tiempo real del muro de ideas, con cola FIFO y tarjeta destacada. |
| `/admin` | Autenticado (`admin_global`) | Panel administrativo global para supervisión de plataforma, métricas, gestión de estados y auditoría de eventos. |
| `/acerca` | Público | Modal/página institucional de versión y créditos. |

---

## 3. Estado Técnico y Funcional Consolidado

### 3.1. Estado de calificación por subsistema

| Subsistema | Calificación | Justificación y Observaciones |
| :--- | :---: | :--- |
| **Muro público y presentación FIFO** | **APTO CON RESERVAS** | Grilla armónica y cola FIFO validadas (12/12 pruebas geométricas pasando). Reserva: defecto de `idea_number` en lecturas anónimas y sincronización de reconexión (§4.1). |
| **Panel de actividad y moderación** | **APTO** | Parche CSS UXUI-07 aplicado y validado visualmente en 6 viewports (Etapa 14L). Flexbox unidimensional, scroll completo sin bloqueo `100vh`, ergonomía móvil verificada. |
| **Exportación CSV / HTML** | **APTO** | Generación de CSV resistente a inyección DDE y UTF-8 BOM con delimitador `;`. Presentación HTML interactiva. Handlers auditados con límites estrictos. |
| **Panel administrativo global (`/admin`)** | **APTO CON RESERVAS** | Doble barrera de seguridad, `authInterrupts` experimental, trazabilidad en `audit_logs` con `contract_version=2`. Reserva: pruebas dinámicas completas requieren contenedor desechable con usuarios sintéticos (§6). |
| **Envío de ideas (`/a/[code]`)** | **APTO** | Server Action con esquema Zod, sanitización de entradas, rate-limiting y deduplicación atómica en PostgreSQL. |
| **Canal de base de datos y migraciones** | **NO APTO PARA PRODUCCIÓN DIRECTA** | Incertidumbre sobre el estado real de migraciones en producción (§5). Migración 10 aplicada localmente sin constancia documental de autorización previa. |

---

## 4. Hallazgos Críticos y Defectos Abiertos de la Auditoría 14O

### 4.1. Defecto de numeración correlativa en lecturas anónimas y catch-up
En la auditoría técnica se identificaron dos inconsistencias vinculadas a la migración `20261028150000_ideas_atomic_numbering.sql`:
1. **Permiso de columna faltante en `ideas` para rol `anon`:**
   - La migración inicial `20261002080804` ejecutó un `GRANT SELECT` restrictivo a nivel de columnas: `(id, activity_id, content, status, created_at, published_at)`.
   - La migración `20261028150000` agregó la columna `idea_number` pero **no emitió** `GRANT SELECT (idea_number) ON public.ideas TO anon;`.
   - Consecuencia: Cualquier consulta directa ejecutada por el cliente anónimo que incluya `idea_number` fallará por denegación de permisos a nivel de columna en PostgreSQL, a menos que se ejecute a través de una función con privilegios elevados o se otorgue el grant explícito.
2. **Omisión de `idea_number` en reconciliación de reconexión (*catch-up*):**
   - En `src/components/live-wall.tsx`, tanto `catchUpQuery` (líneas 329-331) como `discoverQuery` (línea 682) seleccionan explícitamente:
     `"id, activity_id, content, status, created_at, published_at"`
   - Se omite el campo `idea_number`. Las ideas recuperadas tras un corte de conexión o refresco se cargan con `idea_number: undefined`, activando el fallback del componente que oculta el identificador `#N`.

### 4.2. Discrepancia no resuelta de dominios de producción
Existen referencias documentales y de configuración contradictorias en el repositorio:
- **Dominio A:** `https://murocomun.vercel.app` (referenciado en `.env.production`, scripts de prueba y validaciones de autenticación).
- **Dominio B:** `https://muro-participativo-de-ideas.vercel.app` (referenciado en `docs/despliegue.md` como `Site URL` de Supabase Auth).
- **Preview de Vercel:** `https://muro-participativo-de-ideas-aw6gfa7p9-kritio-systems.vercel.app` (equipo `kritio-systems` con protección SSO / Vercel Authentication).
> **Estado:** **PENDIENTE DE CONFIRMACIÓN.** Queda expresamente prohibido asumir o elegir uno de los dominios sin verificación directa de la consola de Vercel y Supabase de producción.

---

## 5. Inventario de Migraciones y Estado de Sincronización

### 5.1. Tabla comparativa de migraciones

| # | Archivo de Migración | Propósito Técnico | Entorno Local | Entorno Producción |
| :-: | :--- | :--- | :---: | :---: |
 en producción documentada en reportes históricos del proyecto, sin consulta remota independiente en la auditoría actual
 en producción documentada en reportes históricos del proyecto, sin consulta remota independiente en la auditoría actual
 en producción documentada en reportes históricos del proyecto, sin consulta remota independiente en la auditoría actual
 en producción documentada en reportes históricos del proyecto, sin consulta remota independiente en la auditoría actual
 en producción documentada en reportes históricos del proyecto, sin consulta remota independiente en la auditoría actual
 en producción documentada en reportes históricos del proyecto, sin consulta remota independiente en la auditoría actual
 en producción documentada en reportes históricos del proyecto, sin consulta remota independiente en la auditoría actual
| 8 | `20261021140000_audit_cascade_counts_v2.sql` | Auditoría V2 con conteos atómicos pre-cascada (`contract_version=2`). | Aplicada | **DESCONOCIDO** (Sin evidencia en prod) |
| 9 | `20261028150000_ideas_atomic_numbering.sql` | Numeración atómica correlativa (`last_idea_number`, `idea_number`). | Aplicada | **DESCONOCIDO** (Sin evidencia en prod) |
| 10 | `20261029170000_export_activity_ideas_rpc.sql` | RPC `export_activity_ideas` para exportación atómica en JSONB. | Aplicada | **DESCONOCIDO** (Sin evidencia en prod) |

> [!WARNING]
> **Constancia de la Migración 10 (`20261029170000`):**
> La migración se encuentra aplicada en la instancia local de PostgreSQL. Sin embargo, en la auditoría documental **no se encontró constancia de autorización formal previa** para dicha aplicación local. Se registra expresamente esta situación sin inferir ni otorgar autorización retroactiva. Antes de promover esta migración a producción, deberá someterse a revisión y aprobación formal.

---

## 6. Estado de Pruebas, Lint y Compilación

### 6.1. Verificación de tipos (TypeScript)
- **Comando:** `npx tsc --noEmit`
- **Resultado:** **0 errores (Código de salida 0)**. Tipado estricto verificado en todo el proyecto.

### 6.2. Pruebas automatizadas (`node:test`)
- **Pruebas de geometría y numeración atómica (`atomic-numbering-and-grid.test.mjs`, `wall-grid-geometry.test.mjs`):** **12/12 aprobadas (100%)**.
- **Pruebas estáticas completas (Exportación, Admin, Submit Idea, Schemas):** **72/72 aprobadas**.
- **Pruebas dinámicas (`admin-dynamic.test.mjs`):**
  - Con `TEST_APP_URL` apuntando al servidor activo: **2 aprobadas, 3 diferidas** formalmente a contenedor desechable (AU-4C) por requerir usuarios sintéticos aprovisionados con rol `admin_global`.
- **Pruebas de concurrencia (`submit-idea-dynamic.test.mjs`):** Requiere entorno desechable aprovisionado con credenciales sintéticas no presentes en el repositorio.

### 6.3. Análisis estático y formateo (Biome)
- **Comando:** `npm run lint` (`biome check`)
- **Resultado:** **Falla con errores de formato**.
- **Causa raíz:** Biome inspecciona por defecto directorios no ignorados, incluyendo `.next-backup-9J-20261031/`, y detecta discrepancias de finales de línea (CRLF vs LF) heredadas en 9 archivos del repositorio, además de dos advertencias de código (`GlobalError` parámetro `error` no utilizado y orden de especificidad en CSS de actividades).
- **Estado:** Requiere configuración explícita de `biome.json` para ignorar directorios de respaldo y normalización controlada de finales de línea.

### 6.4. Compilación de producción (Next.js)
- **Compilador Webpack (`npx next build --webpack`):** **Exitoso (Código de salida 0)**. 14 rutas generadas limpiamente en 11.4s.
- **Compilador Turbopack por defecto (`next build`):** **Falla en Windows** cuando la ruta física contiene espacios (`Muro Partisiativo de Ideas`), debido a la resolución interna del módulo PostCSS en el VFS de Turbopack.

---

## 7. Estado del Repositorio Git y Entorno

### 7.1. Historial de commits relevantes en `Dev`
```text
dbc2f35 (HEAD -> Dev) fix(panel): restaurar distribución vertical y scroll del detalle de actividad
174b2d4 (origin/Dev) feat(wall,panel,admin): numeración correlativa atómica, grilla armónica y correcciones de compilación
d446e02 feat(export): unificar snapshot consistente en sql y asegurar orden determinista en jsonb_agg
6632e80 feat(export): eliminar fallback no atomico, validar contrato RPC y preparar migracion
18b106e feat(export): endurecer proteccion CSV, preparar adaptador RPC y ampliar pruebas de contrato
```
- **Commit `174b2d4`:** Sincronizado exitosamente con `origin/Dev` en GitHub (Etapa 14E).
- **Commit `dbc2f35`:** Commit local en `Dev`, pendiente de push (§7.2).
- **Rama `main`:** Permanece en commit `cd94282` (estable, sin alteraciones no autorizadas).

### 7.2. Estado actual de staging y working tree
- **Staging (`git diff --cached`):** **0 archivos staged**.
- **Archivos modificados en working tree (9 preexistentes):**
  - Diferencias de finales de línea CRLF preservadas:
    - `src/app/admin/actions.ts`
    - `src/app/admin/admin.css`
    - `src/app/admin/components/admin-activity-row.tsx`
    - `src/app/admin/components/admin-idea-row.tsx`
    - `src/app/admin/schemas.ts`
    - `src/app/panel/actividad/[id]/panel-live-refresh.tsx`
    - `src/components/idea-form.tsx`
    - `src/lib/auth/admin.ts`
    - `src/lib/presentation.ts`
- **Elementos no rastreados (*untracked*) preservados (7 elementos):**
  - `.next-backup-9J-20261031/`
  - `docs/PANEL-01-auditoria-ux-ui.md`
  - `docs/PANEL-01-propuesta-reorganizacion-ux-ui.md`
  - `docs/capturas-muro-grilla/`
  - `docs/ficha-PANEL-01-mejoras-panel-administracion.md`
  - `docs/historico-auditorias/`
  - `docs/plantillas/`
- **Respaldos e infraestructura auxiliar:**
  - `C:\MuroDev` (worktree preservado).
  - Junction `C:\MuroParticipativoIdeas` (preservado).

---

## 8. Decisiones Expresamente Autorizadas vs Pendientes

| Decisión Técnica / Funcional | Estado de Autorización | Evidencia / Alcance |
| :--- | :---: | :--- |
| **Numeración correlativa atómica (`last_idea_number`)** | **AUTORIZADA** | Migración `20261028150000` y tests en `174b2d4`. |
| **Grilla armónica híbrida en muro público** | **AUTORIZADA** | Algoritmo progresivo de 1 a 48 ideas en `174b2d4`. |
| **Parche CSS UXUI-07 en panel de actividad** | **AUTORIZADA** | Commit `dbc2f35` tras validación visual 14L. |
| **Módulo de exportación CSV y HTML Slide Deck** | **AUTORIZADA** | Commits `18b106e` a `d446e02` y migración 10 local. |
| **Auditoría administrativa V2 (`audit_logs`)** | **AUTORIZADA LOCAL** | Implementada en `20261021140000`, pendiente verificación en prod. |
| **Aplicación de Migración 10 en Producción** | **NO AUTORIZADA** | Requiere aprobación formal previa. |
| **Corrección del Grant de `idea_number` para `anon`** | **PENDIENTE DE AUTORIZACIÓN** | Identificada en 14O, pendiente de implementación en 15A. |
| **Normalización masiva de finales de línea CRLF** | **NO AUTORIZADA** | Debe realizarse en commit de saneamiento exclusivo. |

---

## 9. Riesgos Abiertos y Mitigaciones Requeridas

1. **Riesgo de denegación de servicio por schema drift en producción (ALTO):**
   - Si el código de `Dev` (`174b2d4` / `dbc2f35`) se despliega a producción antes de que las migraciones 8, 9 y 10 estén aplicadas, el muro fallará al consultar `idea_number` o las Server Actions fallarán por falta del trigger de numeración.
   - *Mitigación:* Prohibido ejecutar `git merge Dev main` o desplegar a producción sin auditar antes la base de producción mediante `supabase migration list`.
2. **Riesgo de inconsistencia visual en el muro anónimo (MEDIO):**
   - Debido a la falta de grant de `idea_number` para `anon` y la omisión en `catchUpQuery`, los números `#N` pueden parpadear o desaparecer tras reconexión.
   - *Mitigación:* Crear una migración aditiva correctiva (`GRANT SELECT (idea_number) ... TO anon`) y agregar el campo a las queries de `live-wall.tsx`.
3. **Fallas en pipelines automáticos de CI por Biome (MEDIO):**
   - El comando `npm run lint` fallará en GitHub Actions si se ejecuta sobre el árbol actual.
   - *Mitigación:* Excluir respaldos en `biome.json` y planificar un commit aislado para normalización de formato.

---

## 10. Hoja de Ruta Priorizada (Roadmap)

### Fase 1: Sincronización Segura de Dev y Correcciones Críticas (Inmediata)
1. **Paso 1.1 — Push controlado de commit `dbc2f35` a `origin/Dev`:**
   - Verificar SHA remoto de `origin/Dev` (`174b2d4`).
   - Ejecutar `git push origin Dev`.
2. **Paso 1.2 — Subsanación del defecto de numeración (Etapa 15A):**
   - Crear migración aditiva `GRANT SELECT (idea_number) ON public.ideas TO anon;`.
   - Incluir `idea_number` en `catchUpQuery` y `discoverQuery` de `src/components/live-wall.tsx`.
   - Validar con pruebas automatizadas.

### Fase 2: Auditoría y Sincronización de Base de Datos de Producción (Bloqueante para Release)
1. **Paso 2.1 — Verificación de credenciales y CLI de Supabase:**
   - Enlazar temporalmente el CLI con el proyecto de producción (`supabase link`).
   - Ejecutar `supabase migration list` en solo lectura y determinar exactamente qué migraciones están aplicadas.
2. **Paso 2.2 — Plan de aplicación controlada de migraciones 8, 9 y 10:**
   - Ejecutar `supabase db push` únicamente tras validar respaldo completo de producción.
3. **Paso 2.3 — Confirmación de dominio canónico:**
   - Validar en consola de Vercel y Supabase Auth si el dominio oficial es `murocomun.vercel.app` o `muro-participativo-de-ideas.vercel.app`.

### Fase 3: Integración a Main y Despliegue a Producción
1. **Paso 3.1 — Pull Request auditado de `Dev` hacia `main`:**
   - Revisión completa de diff consolidado.
   - Fast-forward o merge commit limpio.
2. **Paso 3.2 — Verificación de deployment en Vercel:**
   - Monitorear build de producción y validar en vivo los 5 flujos críticos del producto.

---

## 11. Procedimiento Operativo para Retomar el Trabajo

Cualquier operador que continúe con este repositorio debe seguir estrictamente este protocolo:

1. **Ubicación obligatoria:**
   - Trabajar exclusivamente en la raíz física:
     `C:\Users\lucas\Desktop\Proyectos de 2026\Muro Partisiativo de Ideas`
   - Prohibido trabajar desde clones o carpetas auxiliares.
2. **Verificación de estado inicial:**
   ```powershell
   git status --short
   git rev-parse HEAD
   git branch --show-current
   ```
   - Confirmar que la rama es `Dev`.
   - Confirmar que HEAD es `dbc2f356bb6fe2f8906590652a5351e446a6db8b`.
   - Confirmar que los 9 archivos CRLF y 7 untracked están intactos.
3. **Para ejecutar pruebas locales:**
   ```powershell
   node --test tests/atomic-numbering-and-grid.test.mjs tests/wall-grid-geometry.test.mjs
   npx tsc --noEmit
   ```
4. **Para compilar localmente:**
   - Utilizar siempre el flag Webpack en este entorno Windows:
     ```powershell
     npx next build --webpack
     ```
5. **Regla de oro de base de datos:**
   - **NUNCA** ejecutar `supabase db push` o `supabase db reset` sin autorización expresa y verificación del entorno destino.
