# Informe de cierre — Remediación REM-01 (Desacoplamiento determinista de prueba 54)

**Fecha:** 2026-11-04 · **Entorno:** Local / Repositorio Git · **Alcance:** Pruebas automatizadas de auditoría y política Git · **Documento rector:** `puntos_fundamentales_desarrollo_software.md`

> **Estado:** La remediación **REM-01** queda **formalmente cerrada e integrada en `main`**. La prueba 54 de la suite de auditoría de ramas (`tests/audit-feature-branches.test.cjs`) ha sido desacoplada de la existencia y estado de ramas transitorias locales o remotas (como `docs/feature-lifecycle-policy` u `origin/main`), evaluando la matriz completa de códigos de retorno mediante ejecuciones reales de Git sobre referencias canónicas locales y verificando la clasificación de errores fatales y de lanzamiento en la lógica de decisión.

---

## 1. Identificación del Hallazgo (REM-01)

- **Identificador:** REM-01.
- **Origen:** Cuarta etapa de auditoría técnica independiente (noviembre de 2026).
- **Componente afectado:** `tests/audit-feature-branches.test.cjs` (específicamente la prueba 54: *"Prueba 54: Separación inequívoca: resultados de excepciones (-1) y códigos reales (1) no son intercambiables"*).
- **Naturaleza del defecto:** Fragilidad por acoplamiento dinámico. La prueba dependía de la existencia, ausencia o estado de integración de ramas transitorias en el entorno Git circundante (en particular la rama efímera `docs/feature-lifecycle-policy` frente a `origin/main`). Si dichas ramas eran modificadas, fusionadas o eliminadas durante el ciclo de vida del repositorio, la prueba fallaba por la mutabilidad del entorno de trabajo y no por un defecto en el producto ni en la lógica del script de auditoría.

---

## 2. Corrección Implementada

- **Archivo autorizado e intervenido:** `tests/audit-feature-branches.test.cjs`.
- **Estrategia técnica y desacoplamiento:**
  - **Desacoplamiento ambiental:** La prueba ya no depende de la existencia o estado de la rama transitoria `docs/feature-lifecycle-policy` ni de una condición particular de `origin/main`. En su lugar, opera sobre relaciones estructurales inmutables de la historia local del repositorio (`HEAD` y `HEAD~1`).
  - **Ejecución efectiva de Git:** La prueba no fue sustituida en su totalidad por fixtures en memoria, ni es completamente independiente del entorno Git; continúa invocando al binario real de Git mediante `gitExec` para validar los comportamientos del proceso del sistema operativo.
  - **Evaluación de la matriz de códigos (0, 1, 128 y -1):**
    - **Código 0:** Comprobación mediante ejecución real de Git evaluando `merge-base --is-ancestor HEAD~1 HEAD` en el árbol local. Comprueba que `verifyIntegrationEvidence` clasifique la relación como integrada (`integrated: true`, `mode: 'normal_merge'`).
    - **Código 1:** Comprobación mediante ejecución real de Git evaluando `merge-base --is-ancestor HEAD HEAD~1` sobre commits válidos donde no existe relación de ancestría en el sentido evaluado (al ser `HEAD` descendiente de `HEAD~1`). Comprueba que `verifyIntegrationEvidence` retorne `integrated: false` y `mode: 'not_integrated'` (y jamás `git_error`).
    - **Código 128:** Comprobación de error fatal de Git mediante ejecución real de `rev-parse --verify refs/heads/nonexistent_test_branch_999999` sobre una referencia inexistente.
    - **Código -1:** Comprobación de fallo de lanzamiento o excepción de spawn invocando `gitExec` con una variable de entorno `PATH` apuntando a un directorio vacío sin el binario de Git.
    - **Inyección de resultados para verificación lógica:** Se utiliza la inyección de los resultados reales obtenidos (128 y -1) para comprobar que la función `verifyIntegrationEvidence` clasifique ambos de forma inequívoca como `git_error` y nunca como `not_integrated`, acreditando la disyunción estricta de ambos modos.

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
   - Cobertura de la prueba 54: PASS determinista, desacoplada de ramas transitorias, evaluando tanto ejecuciones reales de Git como la correcta clasificación de errores en la lógica de decisión.
3. **Matriz de códigos de retorno evaluada:**
   - Código `0`: Éxito / relación de ancestro confirmada en ejecución real (`HEAD~1` en `HEAD`).
   - Código `1`: Ausencia legítima de ancestría en ejecución real (`HEAD` en `HEAD~1`).
   - Código `128`: Error de entorno Git (fatal por referencia inexistente).
   - Código `-1`: Error inesperado o falla en el lanzamiento del proceso (PATH sin Git).

---

## 5. Limitaciones Registradas y Estado de la Suite General

- **Estado previo de la suite general:** En la auditoría integral previa se registraron **131 PASS, 0 FAIL y 1 BLOCKED** (sobre un total de 132 casos en las 8 suites del proyecto).
- **Prueba bloqueada:** `tests/submit-idea-dynamic.test.mjs` continúa en estado **BLOCKED** debido a la ausencia de credenciales sintéticas de prueba locales en el entorno de Supabase local (`NEXT_PUBLIC_SUPABASE_URL` / claves locales no aprovisionadas en el runner).
- **Alcance de la revalidación posterior al merge:** Se aclara expresamente que **la suite general completa no se volvió a ejecutar tras la fusión del PR #10**. La única suite ejecutada y certificada sobre el commit `9dbdd6874b585719f26549093aff4dc52e624b66` fue `tests/audit-feature-branches.test.cjs` (54 pruebas).
