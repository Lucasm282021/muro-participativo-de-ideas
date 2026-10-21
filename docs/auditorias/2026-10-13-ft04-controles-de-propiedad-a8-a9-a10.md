# Informe FT-04 — Controles de propiedad de Server Actions A8/A9/A10 (entorno local desechable)

**Fecha:** 2026-10-13 · **Entorno:** Supabase desechable `Muro_Audit_D0` (API `127.0.0.1:55321`, DB `127.0.0.1:55322`, contenedor `supabase_db_Muro_Audit_D0`) · **App:** `next dev --webpack -H 127.0.0.1 -p 3001` con `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321` · **Candidata:** worktree `muro-main-r1-wt`, HEAD `4f5416465052fee316a442d014eefd85806c994e`.

> **Estado:** A8/A9/A10 **APROBADOS provisionalmente**, limitado al alcance de las pruebas ejecutadas (rechazo de usuario **no propietario**). **No** constituye demostración de una mutación legítima completa ni aptitud de producción.
> **Aislamiento físico LAN/Wi-Fi: NO demostrado** (sin segundo equipo). Sin operaciones remotas, sin producción, sin Git.

> **Convención:** se distingue **“Verificación directa”** (salida observada) de **“Conclusión derivada”** (inferencia). Las conclusiones no amplían lo comprobado.
>
> **Nota de seudonimización:** los correos y UUID de las cuentas/recurso de prueba se sustituyeron por identificadores seudónimos (`OWNER_TEST`, `NON_OWNER_TEST`, `ACTIVITY_TEST`, `IDEA_TEST`). Se conservan la demás evidencia técnica necesaria para comprender y reproducir los resultados.

## 1. Objetivo y alcance
Verificar dinámicamente que las Server Actions A8/A9/A10 rechazan una operación de un usuario **autenticado pero no propietario** del recurso, sin producir modificaciones. Solo pruebas **negativas** + control no mutante del propietario.

## 2. Mapeo de acciones (build dev Webpack en ejecución)
| Caso | Acción | Action ID | Origen | Campos |
|---|---|---|---|---|
| A8 | `moderateIdeaAction` | `401b3d5040d57058758d82d64fde1c4671d808f5e8` | `src/app/actions.ts:261` | `idea_id`, `activity_id`, `status ∈ {published,hidden}` |
| A9 | `setModerationModeAction` | `40163865dfaaf894090dce2554fed9c8064ac7edcc` | `src/app/actions.ts:346` | `activity_id`, `moderation_mode ∈ {automatic,approval}` |
| A10 | `toggleActivityAction` | `40edd8440554c7ba0bec0980c1e21852d3c4a2424f` | `src/app/actions.ts:407` | `activity_id`, `status ∈ {open,closed}` |

### 2.1 Nota de nomenclatura y alcance (serie FT)

Para que este informe sea autocontenido, se fija aquí la nomenclatura **propia de la serie FT** (distinta de otras usadas en el repositorio):

- **A<n>** numera las 11 Server Actions **por orden de aparición en `src/app/actions.ts`**: A6 = `createActivityAction` (`actions.ts:171-206`), A8 = `moderateIdeaAction` (`:261`), A9 = `setModerationModeAction` (`:346`), A10 = `toggleActivityAction` (`:407`), A11 = `deleteActivityAction` (`:468-513`).
- **D-<n>** numera las pruebas dinámicas de la serie FT: **D-1** = controles de propiedad de A8/A9/A10 (ejecutada en este informe, §7-§9); **D-3** = ausencia de fuga de ideas `pending`/`hidden` en el HTML inicial y en los datos serializados RSC del muro público (`/muro/[code]`).
- **A6, A11 y D-3 quedaron fuera de ejecución** en este informe (§10.3). Su análisis estático se documenta por separado cuando se autorice.

> **Advertencia de homonimia (no confundir series):** el repositorio usa otras numeraciones `A*`/`D*` que **no** coinciden con la de este informe: (i) `docs/estado-actual-del-producto.md` usa `A1–A9` para la validación manual del MVP (allí `A6` = "Moderación"); (ii) `docs/evaluacion-cola-de-presentacion.md` usa `A1–A10` para decisiones arquitectónicas (allí `A6` = "identidad visual por `id`"); (iii) `docs/auditorias/2026-10-12-cierre-a2-rate-limit-dedupe.md` usa `A6`/`A11` como casos de la matriz del A2; (iv) `D3` en `docs/estado-actual-del-producto.md:318` es la discrepancia por la ausencia del documento funcional de la cola (no una prueba). Toda referencia cruzada debe indicar la serie.

## 3. Verificación estática
Las tres: (1) **autenticación** `auth.getUser()` → `redirect("/ingresar")` si no hay usuario; (2) **autorización/propiedad** `activities.select(...).eq("id", activityId).eq("owner_id", user.id)`; sin fila → `console.error("Actividad no encontrada o el usuario no es el propietario.")` + `return` (sin escritura). Defensa en profundidad: RLS (migración R1 `20261012142000_…` restringe la lectura pública de `activities` a `anon`).

## 4. Aislamiento del entorno
Servidor apuntado exclusivamente a `127.0.0.1:55321` (desechable). Verificación directa: sin conexiones establecidas a los puertos del stack compartido (`25433-25436`) ni a producción; regla `Muro_Audit_D0_TempBlock_5532x` (Enabled/Inbound/Block/TCP/55321-55324/Any) intacta. Identidad por nombre de contenedor `supabase_db_Muro_Audit_D0`.

## 5. Método de invocación
Se reprodujo el mecanismo propio de la app: `POST /panel/actividad/<id>` con `multipart/form-data` y campo `$ACTION_ID_<id>` (mejora progresiva de formularios). Verificación directa de fidelidad: el HTML renderizado por la app emite los mismos campos `$ACTION_ID_…` (p. ej. `signOutAction`). Sesión enviada como cookie de `@supabase/ssr`.

## 6. Datos y cuentas de prueba (desechables; **eliminados al cierre**)
| Recurso | Identificador seudónimo |
|---|---|
| Cuenta propietaria | `OWNER_TEST` |
| Cuenta no propietaria | `NON_OWNER_TEST` |
| Actividad de prueba (open/automatic) | `ACTIVITY_TEST` |
| Idea de prueba (published) | `IDEA_TEST` |

Verificación directa: `GET /panel` sin cookie → 307 `/ingresar`; con cookie no-propietario → 200 (sin actividades); con cookie propietario → 200 (ve su actividad).
**Conclusión derivada:** las sesiones son válidas y la identidad corresponde al backend desechable.

## 7. Pruebas negativas (sesión no propietario)
| Caso | Prueba | Resultado observado | Evidencia | Estado |
|---|---|---|---|---|
| A8 | ocultar idea ajena | HTTP **404**, sin cambio | log `no es el propietario`=SÍ; estado `open/automatic/published` antes y después | **APROBADO** |
| A9 | cambiar modo ajeno | HTTP **404**, sin cambio | log `no es el propietario`=SÍ; estado idéntico | **APROBADO** |
| A10 | cerrar actividad ajena | HTTP **404**, sin cambio | log `no es el propietario`=SÍ; estado idéntico | **APROBADO** |

## 8. Control de contraste (no mutante)
Sesión **propietario**, mismo valor actual (no-op) en A8/A9/A10 → HTTP **200**, log `no es el propietario`=**NO**. **Conclusión derivada:** la compuerta de propiedad se abre para el dueño; el rechazo de §7 se debe a la propiedad, no a un fallo de despacho.

## 9. Sonda RLS (solo lectura) y causa del 404
`GET /rest/v1/activities?select=id,status,owner_id,moderation_mode&id=eq.<ACTIVITY_TEST>`:
- no-propietario (`role=authenticated`) → HTTP 200, cuerpo `[]`
- propietario (`role=authenticated`) → HTTP 200, 1 fila
**Verificación directa:** el 404 de §7 es el re-render de `/panel/actividad/<id>` tras el `return` temprano; la consulta de la página devuelve `null` (RLS de R1) → `notFound()`.

## 10. Limitaciones
1. Solo pruebas negativas + control no mutante; **no** se ejecutó mutación legítima positiva (fuera de alcance).
2. **Aislamiento físico LAN/Wi-Fi no demostrado** (sin segundo equipo).
3. No se ejecutaron A6, A11 ni D-3 (nomenclatura y alcance en §2.1).
4. Resultado acotado a este build dev (Webpack) y a este entorno desechable.

## 11. Integridad y limpieza
Verificación directa: desechable `activities/ideas/participants/idea_authors = 0/0/0/0`, `auth.users=0` (cuentas de prueba eliminadas en cascada); compartido 9 contenedores / 8 listeners `25433-25436` / `activities=18` intacto; regla firewall intacta; worktree sin cambios (HEAD `4f54164`, solo 2 `docs/` preexistentes). Puerto 3001 liberado. Archivo temporal con cookies de sesión eliminado; **ningún secreto impreso**.

## 12. Conclusión
A8/A9/A10 **APROBADOS provisionalmente**: la solicitud de un usuario no propietario fue rechazada (guarda de propiedad en la acción + RLS) sin modificar datos. Verificación estática, sonda RLS y control del propietario son **evidencias complementarias**, no una demostración de mutación legítima completa.
