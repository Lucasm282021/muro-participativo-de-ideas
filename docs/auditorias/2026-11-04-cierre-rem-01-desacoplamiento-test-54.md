# Informe de cierre — Remediación REM-01 (Desacoplamiento determinista de prueba 54)

**Fecha:** 2026-11-04 · **Entorno:** Local / Repositorio Git · **Alcance:** Pruebas automatizadas de auditoría y política Git · **Documento rector:** `puntos_fundamentales_desarrollo_software.md`

> **Estado:** La remediación **REM-01** queda **formalmente cerrada e integrada en `main`**. El comportamiento de la suite de auditoría de ramas (`tests/audit-feature-branches.test.cjs`) ha sido desacoplado de las ramas transitorias locales o remotas mediante fixtures deterministas en memoria y aserciones directas sobre los códigos de salida controlados.

---

## 1. Identificación del Hallazgo (REM-01)

- **Identificador:** REM-01.
- **Origen:** Cuarta etapa de auditoría técnica independiente (noviembre de 2026).
- **Componente afectado:** `tests/audit-feature-branches.test.cjs` (específicamente la prueba 54: *"Prueba 54: El script retorna código 1 ante ramas activas no integradas"*).
- **Naturaleza del defecto:** Fragilidad por acoplamiento dinámico. La prueba invocaba el script `scripts/audit-feature-branches.cjs` contra el entorno real de Git del repositorio de trabajo. Si no existían ramas activas sin fusionar (o si se encontraban fusionadas o eliminadas), el script retornaba exit code `0` en lugar de `1`, provocando un falso negativo (*FAIL*) no atribuible a un defecto en la lógica del script ni en el producto, sino a la volatilidad del estado ambiental de Git.

---

## 2. Corrección Implementada

- **Archivo autorizado e intervenido:** `tests/audit-feature-branches.test.cjs`.
- **Estrategia técnica de desacoplamiento:**
  - Sustitución de la invocación de subproceso dependiente del entorno Git vivo por una prueba sintética y determinista con stubbing/inyección de datos en memoria para la simulación del script de auditoría.
  - Preservación de la verificación semántica de la regla de gobernanza: comprobar que cuando existen ramas no integradas el resultado sea estrictamente código `1`, y cuando el árbol cumple las políticas sea código `0`.
  - Normalización de las aserciones sobre la matriz de códigos de salida del proceso (`0`, `1`, `128` y `-1`).

---

## 3. Trazabilidad de Integración en Git y GitHub

- **Rama de origen:** `fix/audit-test-54-decoupling`
- **Rama de destino:** `main`
- **Commit local de corrección:** `a87ee4e32624ece9d5a3897216b1c2655c7de992`
- **Pull Request asociado:** [PR #10 — test(audit): desacoplar prueba 54 de ramas fusionadas](https://github.com/Lucasm282021/muro-participativo-de-ideas/pull/10)
- **Estado del PR:** Cerrado y fusionado (`closed` / `merged: true`).
- **Modalidad de merge:** Merge commit estándar de 2 padres.
- **Commit de integración en `main`:** `9dbdd6874b585719f26549093aff4dc52e624b66`
- **Commit padre 1 (base previa de `main`):** `3f2fb305ea4a3942714e920033df7f38295cced3`
- **Commit padre 2 (origen):** `a87ee4e32624ece9d5a3897216b1c2655c7de992`
- **Fecha de integración:** 04/11/2026.

---

## 4. Validación Posterior sobre `main`

Ejecutada de manera aislada sobre el árbol integrado de `main` (`9dbdd68`):

1. **Sintaxis del archivo de prueba:**
   - Comando: `node -c tests/audit-feature-branches.test.cjs`
   - Resultado: Sin errores de sintaxis (exit code `0`).
2. **Suite de auditoría de ramas:**
   - Comando: `node tests/audit-feature-branches.test.cjs`
   - Resultado: **54/54 PASS** (código de salida `0`).
   - Cobertura de la prueba 54: PASS determinista e independiente del contexto Git circundante.
3. **Matriz de códigos de retorno evaluada:**
   - Código `0`: Éxito / todas las ramas conformes o integradas.
   - Código `1`: Ramas activas sin integrar detectadas o violación de políticas.
   - Código `128`: Error de entorno Git (fatal / repositorio no válido).
   - Código `-1`: Error inesperado o falla en la ejecución del proceso.

---

## 5. Limitaciones Registradas y Estado de la Suite General

- **Estado previo de la suite general:** En la auditoría integral previa se registraron **131 PASS, 0 FAIL y 1 BLOCKED** (sobre un total de 132 casos en las 8 suites del proyecto).
- **Prueba bloqueada:** `tests/submit-idea-dynamic.test.mjs` continúa en estado **BLOCKED** debido a la ausencia de credenciales sintéticas de prueba locales en el entorno de Supabase local (`NEXT_PUBLIC_SUPABASE_URL` / claves locales no aprovisionadas en el runner).
- **Alcance de la revalidación posterior al merge:** Se aclara expresamente que **la suite general completa no se volvió a ejecutar tras la fusión del PR #10**. La única suite ejecutada y certificada sobre el commit `9dbdd6874b585719f26549093aff4dc52e624b66` fue `tests/audit-feature-branches.test.cjs` (54 pruebas).

