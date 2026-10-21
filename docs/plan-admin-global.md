# Plan para la página de administración global

**Rama base:** `Dev`  
**Commit base:** `0a12e2a`  
**Rama de trabajo:** `feat/pagina-administracion-from-dev`  
**Estado:** Preparación (solo documentación). No implementado.

## 1. Objetivo

Planificar la futura página de administración global (`/admin`) que permita, según permisos, consultar, moderar y administrar actividades globalmente, sin romper las protecciones existentes basadas en `owner_id`.

## 2. Verificación previa (realizada)

- Rama actual: `feat/pagina-administracion-from-dev` (creada desde `Dev`)
- `HEAD`: `0a12e2a` (coincide con `origin/Dev`)
- `origin/feat/pagina-administracion`: existe (`c73fec7`) pero no fue tocada/reutilizada
- Árbol: solo fantasmas LF/CRLF (`src/app/panel/page.tsx`, `src/lib/presentation.ts`)
- `Dev` sin cambios; `Main`/producción fuera de alcance

## 3. Modelo de roles y permisos

Se propone un modelo mínimo, sin romper el modelo actual (organizador por actividad).

| Rol | Alcance | Permisos |
|---|---|---|
| `organizer` (actual) | Dueño de sus actividades | Crear/editar/moderar/eliminar sus actividades; ver participantes/autores de sus actividades |
| `admin_global` | Global | Ver/moderar/cerrar/reabrir/eliminar cualquier actividad; ver listado global; (futuro) gestión de usuarios |

**Asignación:** tabla dedicada `public.user_roles` (solo rol elevado `admin_global`). El rol `organizer` es implícito (cualquier usuario autenticado) y NO se almacena. `admin_global` es el único rol explícito previsto inicialmente. No se usan `profiles` ni claims JWT en esta fase. La lectura del rol es exclusivamente en servidor. Bootstrap y revocación de rol se realizan fuera de la aplicación.

**Requisitos:**
- Mantener owner-scoped intacto. Acciones globales deben validar explícitamente `role === 'admin_global'`.
- Nunca confiar en UI. La autorización se comprueba en servidor en cada página `/admin/**` y en cada Server Action administrativa; RLS es la segunda barrera.
- No exponer el rol al cliente: la UI no decide autorización. El rol se evalúa en servidor y en RLS vía `public.is_admin()`.

**Alcance administrativo (inicial):**
- `activities`: consulta global (incluye `draft`), cierre/reapertura y eliminación.
- `ideas`: moderación (publicar/ocultar) y eliminación.
- `participants` e `idea_authors`: solo lectura global.
- **Excluido:** administración de cuentas de usuario, gestión de roles desde la app, reasignación de `owner_id`, edición de contenido.

## 4. Rutas propuestas

Estructura nueva bajo `src/app/admin/`:

- `/admin` — Dashboard global (listado de actividades con filtros)
- `/admin/actividades/[id]` — Detalle global (moderación, toggle estado, eliminar)

**Protección servidor-side:**
- Proxy (`src/proxy.ts`, ya existente; extender `matcher`/`updateSession`) para `/admin/**`: gate grueso de sesión. Capa ADICIONAL, nunca el único control.
- Server Components y Server Actions validan el rol de forma autoritativa (defensa en profundidad + RLS).

## 5. Políticas RLS propuestas (documentadas, NO aplicar ahora)

Las políticas owner-scoped actuales y los permisos de `anon` permanecen intactos. Se agregan políticas ADITIVAS que otorgan a `admin_global` acceso global, gateadas por `public.is_admin()`:

- `public.user_roles`: RLS habilitado, sin grants ni políticas para `anon`/`authenticated`; solo `service_role`. Sin `FORCE ROW LEVEL SECURITY`.
- `public.is_admin()`: `security definer`, `stable`, `set search_path = ''` con nombres `public.*`, `execute` solo para `authenticated`. El owner de la función debe ser el owner de `user_roles` (rol de migración) para que el definer omita RLS.
- Políticas `SELECT`/`UPDATE`/`DELETE` por `is_admin()` sobre `activities` e `ideas`; `SELECT` sobre `participants` e `idea_authors`. `UPDATE` con `WITH CHECK (public.is_admin())` (nunca `WITH CHECK (true)`).
- No se eliminan ni debilitan políticas existentes: las nuevas son aditivas (OR con las owner-scoped).
- `owner_id` no debe ser modificable por las capacidades administrativas ordinarias: grants de `UPDATE` por columna en `activities` (excluir `owner_id`), a validar en base de pruebas antes de aplicar.
- Sin `service_role` en la aplicación. Bootstrap y revocación de rol se realizan fuera de la app.

## 6. Archivos propuestos

**Nuevos:**
- `src/app/admin/layout.tsx`
- `src/app/admin/page.tsx`
- `src/app/admin/actividades/[id]/page.tsx`
- `src/lib/auth/rol.ts` (helper `getCurrentUserRole`/`isAdmin`)
- `docs/plan-admin-global.md`

**Modificaciones futuras (no ejecutar):**
- `src/app/actions.ts` (acciones admin-only con verificación de rol)
- `src/proxy.ts` y `src/lib/supabase/proxy.ts` (extender matcher/gate para `/admin`)
- Migración futura: `supabase/migrations/<ts>_admin_global_roles.sql` (`user_roles` + `is_admin()` + políticas aditivas)
- UI: enlaces condicionales solo si `admin_global`

## 7. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Bypass UI | Alta | Validación de rol en páginas `/admin/**` y toda Server Action admin; `proxy.ts` solo capa extra; RLS segunda barrera |
| RLS vs lógica app | Alta | Owner-scoped + `anon` intactos; solo políticas aditivas `is_admin()` |
| `owner_id` modificable | Alta | Grants de `UPDATE` por columna en `activities` (excluir `owner_id`); alternativa: trigger de inmutabilidad |
| Propietario de `is_admin()` / FORCE RLS | Alta | Función y `user_roles` comparten owner (rol de migración); NO usar `FORCE ROW LEVEL SECURITY` |
| Cascada de eliminación | — | Confirmada en P0 (`ON DELETE CASCADE`); sin cambios |
| Leak de datos (PII) | Media-Alta | Minimizar columnas; logs sin PII; `participants`/`idea_authors` solo lectura admin |
| Migraciones de producción no verificadas | Media | Reconfirmar migraciones aplicadas antes de habilitar admin |
| Divergencia de ramas | Baja | Trabajar en `feat/pagina-administracion-from-dev` |

## 8. Pruebas de autorización (propuestas)

- NEG-01: Organizador sin rol → `/admin` denegado/redirigido
- NEG-02: Organizador accede `/admin/actividades/[id]` ajena → denegado
- NEG-03: Acción admin-only con rol `organizer` → rechazada
- POS-01: `admin_global` accede `/admin` y ve listado global
- POS-02: `admin_global` modera actividad ajena → éxito
- INT-01: Eliminación global con cascada correcta

## 9. Criterios de aceptación (pre-implementación)

- [x] Rama creada: `feat/pagina-administracion-from-dev` desde `Dev` (0a12e2a)
- [x] `docs/plan-admin-global.md` creado con secciones 1-9 completas
- [ ] Aprobación explícita para pasar a implementación
- [ ] Confirmación estrategia RLS antes de migraciones
- [ ] Verificación cascada antes de habilitar borrado global

## 10. Notas

- **T8/D2**: aceptado con limitación documentada; cierre formal pendiente.
- **Lint**: 5 errores Biome (CRLF/LF) preexistentes — no corregidos.
- **Exclusiones respetadas**: sin implementar interfaz/acciones/admin, sin migraciones/código, sin commits/push/despliegues, sin tocar `Main`/`Dev`/remoto.
