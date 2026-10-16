# Informe de implementación A2 — Límite de envíos y deduplicación (entorno local)

**Fecha:** 2026-10-12 · **Entorno:** Supabase local (DB `127.0.0.1:25433`, API `127.0.0.1:25435`, contenedor `supabase_db_Muro_Partisiativo_de_Ideas`) · **Alcance:** local; **sin** operaciones remotas, **sin** producción, **sin** Git. CLI usado: `npx supabase migration up --local`.

> **Estado:** A2 queda **validado provisionalmente en local**. **No se declara listo para producción.**
> El aislamiento de producción **no** fue verificado y la revalidación HTTP con sesiones reales en producción sigue pendiente.

> **Convención de este informe:** se distingue explícitamente **“Verificación directa”** (salida observada de un
> comando o consulta) de **“Conclusión derivada”** (inferencia a partir de esa evidencia). Las conclusiones no
> amplían lo efectivamente comprobado.

## 1. Objetivo y reglas implementadas
- Tope de **5 ideas aceptadas** por participante+actividad en **ventana móvil de 60 s**.
- Los rechazos **no** consumen cupo (no insertan fila).
- **Deduplicación permanente**: mismo participante + misma actividad + contenido equivalente (aun si la idea está `hidden`).
- Normalización: recortar extremos, colapsar espacios ASCII a uno, ignorar mayúsculas; **se conservan acentos, puntuación y emojis**.
- Orden de evaluación: **primero duplicado, luego límite**.
- Se conservan actividad cerrada/abierta, modos de moderación, RLS y permisos.

## 2. Migración aplicada
- **Archivo:** `supabase/migrations/20261012160000_submit_idea_rate_limit_and_dedupe.sql`
- **Aplicación:** `npx supabase migration up --local` → **Verificación directa:** salida `Applying migration 20261012160000_submit_idea_rate_limit_and_dedupe.sql... Local database is up to date.` y `EXIT=0` (sin `db reset`, sin `db push`).
- **Validación previa:** el SQL se ejecutó primero manualmente dentro de `BEGIN … ROLLBACK`; **Verificación directa:** salida `DROP FUNCTION` / `CREATE FUNCTION` / `REVOKE` / `GRANT` / `ROLLBACK`. No persistió (se confirmó después que la función seguía con la firma antigua).
- **`DROP FUNCTION` + `CREATE FUNCTION`** por cambio de tipo de retorno (`CREATE OR REPLACE` no permite alterar columnas `OUT`).
- **Nueva firma:** **Verificación directa** (`pg_get_function_result`): `TABLE(outcome text, idea_id uuid, idea_status idea_status)`; `prosecdef = t`; `proconfig = {"search_path=\"\""}`.
- **Permisos:** **Verificación directa** (`information_schema.routine_privileges`): `anon` y `authenticated` con `EXECUTE` (además del owner y `service_role`).
- **Registro:** **Verificación directa:** `supabase_migrations.schema_migrations` contiene 4 versiones, incluyendo `20261012160000`.
- **Caché de esquema PostgREST:** se emitió `NOTIFY pgrst, 'reload schema'` y luego se confirmó por llamada HTTP real (§6).
- **Conclusión derivada:** el `DROP FUNCTION` reemplaza el objeto función y no modifica filas de datos; respaldado por los conteos de control invariantes en §12.

## 3. Archivos modificados
- **`src/app/actions.ts`** (`submitIdeaAction`, ~líneas 240-263): lee `data[0].outcome`; devuelve mensaje específico para `duplicate` y `rate_limited`; `accepted` conserva el mensaje según `idea_status`.
- **`src/components/idea-form.tsx`:** **sin cambios** (los mensajes viajan por `state.error`).
- No se incorporó M1/D4. No se tocó ningún otro archivo funcional.

## 4. Diseño del control (resumen)
- Tras el upsert del participante: `pg_advisory_xact_lock(hashtextextended(activity_id||':'||participant_id, 0))` (se libera al terminar la transacción).
- Chequeo de duplicado normalizado (todos los estados) → si existe, `duplicate`.
- Conteo de la ventana (`created_at > now() - interval '60 seconds'`, todos los estados) → si `>= 5`, `rate_limited`.
- Si pasa: inserta `ideas` + `idea_authors` → `accepted`.
- **Verificación directa (local):** `default_transaction_isolation = read committed`, `source = default`; sin override por rol ni por base.
- **Conclusión derivada:** la corrección del conteo/dedupe bajo concurrencia **depende** de `READ COMMITTED`; bajo `REPEATABLE READ`/`SERIALIZABLE` este diseño **no** sería seguro (ver §10).

## 5. Pruebas funcionales (RPC, rol `anon`, vía psql `SET ROLE anon`)
Comando: script `a2-matrix.sql` canalizado por `docker exec … psql -U postgres -d postgres`. **Verificación directa** (resultados observados):

| # | Caso | Resultado real |
|---|---|---|
| A1–A5 | 5 ideas distintas | `accepted/published` ×5 |
| A6 | 6.ª en la ventana | `rate_limited` |
| A7 | `"  Idea    UNO  "` | `duplicate` (orden: duplicado antes que límite) |
| A8 | mismo texto, otro participante | `accepted` |
| A9 | mismo texto, otra actividad | `accepted` |
| A10 | contenido vacío | `ERROR 22023` |
| A11 | actividad inexistente | `ERROR P0002` |
| B1 | tras vaciar la ventana (fixture `created_at -2 min`) | `accepted` |
| C1 | modo aprobación | `accepted/pending` |
| C2 | actividad cerrada | `ERROR` (trigger `set_initial_idea_status`, `check_violation`) |
| C3 | idea `hidden` + mismo texto | `duplicate` |

## 6. Pruebas HTTP (PostgREST real)
Comando: script `a2-http.ps1`, `POST {API_URL}/rest/v1/rpc/submit_idea` con `apikey`/`Bearer` anon. **Verificación directa:** `API_URL` forzada a host `127.0.0.1` puerto `25435` (el script aborta si no es local); las claves se usaron solo en variables y **no** se imprimieron.

| Caso | Resultado real |
|---|---|
| 5 ideas distintas | `accepted/published` ×5 |
| 6.ª | `rate_limited` |
| duplicado normalizado | `duplicate` |

## 7. Concurrencia (sesiones paralelas)
Comando: script `a2-concurrency.ps1` (jobs de PowerShell). **Verificación directa:**

| Prueba | Resultado real |
|---|---|
| 2 idénticas simultáneas | `accepted` ×1 + `duplicate` ×1 |
| 8 distintas simultáneas | `accepted` ×5 + `rate_limited` ×3 |
| Recuento en ventana (consulta de control) | exactamente 5 filas |

## 8. Permisos
**Verificación directa** (rol `anon`):

| Prueba (rol `anon`) | Resultado |
|---|---|
| `INSERT` directo en `public.ideas` | `permission denied` (42501) |
| `SELECT` directo en `public.participants` | `permission denied` (42501) |
| `EXECUTE` de `submit_idea` | permitido |

## 9. Checks estáticos
**Verificación directa:**

| Comando | Resultado real |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx biome check src/app/actions.ts` | **exit 0** |
| `npm run lint` (`biome check`) | **exit 1** — único fallo: **M7 preexistente, `src/components/live-wall.tsx:781`** (formateo de ternaria). **No corregido en esta tarea.** |
| `npm run build` (Next.js 16.3.8, Turbopack) | **exit 0** |

### 9.1 M7 — fallo preexistente, fuera de alcance (no corregido)
- **Archivo/línea:** `src/components/live-wall.tsx:781`.
- **Naturaleza:** error de **formato** de `biome` (la ternaria larga `const actualCardWidth = isWide ? cellWidth * 2 + gap : cellWidth;`). No es un error introducido por A2.
- **Evidencia:** `npm run lint` falla **solo** por ese archivo; `npx biome check src/app/actions.ts` pasa. El archivo no fue tocado en esta tarea.
- **Nota:** preexistente y documentado también en el plan de acción (T11). **Fuera de alcance de A2.**

## 10. Limitaciones pendientes
1. **Aislamiento de producción no verificado.** **Verificación directa:** en local se confirmó `read committed` (sin overrides por rol/base). **No** se ejecutó la comprobación contra producción. **Conclusión derivada:** antes de aplicar la migración en prod debe repetirse esa comprobación; bajo `REPEATABLE READ`/`SERIALIZABLE` el diseño de conteo/dedupe no es seguro.
2. **Identidad basada en email, falsificable.** **Conclusión derivada:** el tope es eludible cambiando de correo; es una defensa anti-abuso, no una frontera de seguridad.
3. **Normalización no colapsa NBSP ni otros espacios Unicode.** Solo cubre espacios ASCII (espacio, `\t`, `\n`, `\r`, `\f`, `\v`). Documentado en el comentario de la migración.
4. Menor: **Verificación directa:** `anon` tiene `statement_timeout=3s` y `authenticator` `lock_timeout=8s`; sin impacto observado en las pruebas.
5. **A2 no está autorizado para producción.** Este informe **no** declara aptitud de producción.

## 11. Datos de prueba conservados en la base local (no eliminados)
**Verificación directa** (consultas de control) — identificadores que **no deben eliminarse sin autorización**:

| Recurso | Identificador |
|---|---|
| Cuenta propietaria `a2-probe-owner@nowhere.test` | `a2a2a2a2-0000-4000-8000-000000000001` |
| Actividad `A2TST001` (abierta/automática) | código público `A2TST001` |
| Actividad `A2TST002` (abierta/automática) | código público `A2TST002` |
| Actividad `A2TST003` (abierta/aprobación) | código público `A2TST003` |
| Actividad `A2TST004` (cerrada) | código público `A2TST004` |
| Participantes | `a2p1@nowhere.test`, `a2p2@nowhere.test`, `a2p3@nowhere.test`, `a2p4@nowhere.test`, `a2p5@nowhere.test` |

- **Volumen de prueba (verificación directa):** 4 actividades / 20 ideas / 7 participantes.
- Se conservan por orden expresa; **ninguna limpieza ejecutada ni planificada** en esta tarea.

## 12. Integridad de datos existentes
- **Verificación directa (consultas de control):** los conteos preexistentes se conservaron tras la implementación: **12 actividades, 170 ideas y 117 participantes** (excluyendo los recursos de prueba `A2TST*`).
- No se ejecutaron `reset`, truncados ni borrados.
- Las sentencias `UPDATE` de *fixture* (ventana en la parte B; ocultamiento para C3) se emitieron con cláusulas `WHERE` acotadas a las actividades `A2TST*` (visible en los comandos ejecutados). **No** se afirma una garantía global más amplia que la respaldada por esas cláusulas y por los conteos de control.
- A/B (`h01-probe-*`) y sus actividades no se reutilizaron ni modificaron (no formaron parte de los `WHERE` de las pruebas de A2).

## 13. Conclusión
A2 implementado y validado **solo en local**, con matriz funcional, HTTP, concurrencia, permisos y checks estáticos en verde (salvo M7 preexistente, fuera de alcance). **No declarado listo para producción** hasta verificar el aislamiento de producción y definir el plan de despliegue.
