# Política Permanente de Ciclo de Vida de Features y Procedimiento de Cierre Técnico

**Proyecto:** Muro Participativo de Ideas
**Repositorio Oficial:** `Lucasm282021/muro-participativo-de-ideas`

---

## 1. Principio Fundamental de Cierre Técnico

En el flujo de ingeniería de Muro Participativo de Ideas, **ninguna funcionalidad (`feat/*`) se considera concluida con la simple aprobación o fusión de su Pull Request en GitHub**.

El ciclo de vida de una feature solo se da por cerrado formalmente cuando se han completado tres garantías técnicas:
1. **Integración verificada:** El código funcional está presente y probado en la rama de destino (`main` o `Dev`).
2. **Despliegue operativo:** El commit resultante ha sido compilado exitosamente y validado en el entorno correspondiente (Vercel Production / Preview).
3. **Limpieza integral:** Los recursos temporales exclusivos de la feature (ramas locales, ramas remotas y carpetas de worktree dedicadas) han sido retirados de forma segura sin dejar referencias huérfanas.

---

## 2. Tipologías de Integración y Criterios de Contención

El procedimiento de verificación varía según la modalidad de fusión empleada en GitHub:

### 2.1. Fusión estándar mediante Merge Commit
- **Mecanismo:** Se crea un commit de unión de dos padres que preserva la historia y SHAs originales de la rama.
- **Verificación de contención:** Se comprueba directamente mediante ancestría Git:
  ```powershell
  git merge-base --is-ancestor <rama-feature> <rama-destino>
  ```
  El comando debe retornar código `0`.

### 2.2. Fusión mediante Squash and Merge
- **Mecanismo:** GitHub condensa todos los commits de la feature en un único commit con nuevo SHA en la rama destino. Los commits individuales de la feature no forman parte del grafo de ancestría de la rama destino.
- **Verificación de contención:**
  1. Comprobar en GitHub API que el PR asociado figure como `closed` y `merged: true`, registrando su `merge_commit_sha`.
  2. Verificar que `git merge-base --is-ancestor <merge_commit_sha> <rama-destino>` retorne código `0`.
  3. Ejecutar `git diff <rama-feature> <rama-destino>` para constatar que no quedan archivos o cambios de la feature sin incorporar.

### 2.3. Integración mediante Rama de Promoción o Cherry-Pick Conjunto
- **Mecanismo:** Los cambios de una o más features se incorporan en una rama intermedia (ej. `promo/*`) que luego se fusiona en destino.
- **Verificación de contención:**
  1. Comprobar que la rama de promoción intermediaria fue fusionada en la rama destino.
  2. Realizar una auditoría de árbol (`git diff <rama-feature> <rama-promo>`) confirmando que todos los archivos aprobados fueron transferidos sin omisiones.

---

## 3. Protocolo Obligatorio de Cierre Técnico (9 Pasos)

Antes de retirar cualquier rama o worktree, se debe ejecutar secuencialmente este protocolo:

1. **Confirmación del PR:** Constatar en GitHub que el PR asociado esté cerrado y fusionado (`merged: true`).
2. **Identificación de la rama destino:** Identificar si el destino canónico fue `main` (producción) o `Dev` (desarrollo).
3. **Verificación de contenido integrado:** Aplicar el criterio de contención correspondiente (§2) para garantizar que no hay trabajo pendiente.
4. **Verificación de despliegue:** Confirmar en Vercel que el deployment del commit destino esté en estado `Ready` y sin errores de ejecución.
5. **Comprobación del Worktree:**
   - Acceder al worktree de la feature.
   - Ejecutar `git status --short`. Debe estar completamente vacío (sin cambios staged, unstaged ni untracked).
   - Confirmar que ningún proceso o terminal mantiene archivos abiertos en el directorio.
6. **Retiro del Worktree Exclusivo:**
   - Desde el repositorio principal, ejecutar:
     ```powershell
     git worktree remove <ruta-absoluta-del-worktree>
     ```
7. **Eliminación Segura de Ramas:**
   - **Rama local:**
     ```powershell
     git branch -d feat/<nombre-feature>
     ```
     *(Nota: Solo usar `-D` si se trata de un Squash o Promoción donde la contención fue demostrada documentalmente y `-d` advierte por ancestría).*
   - **Rama remota:**
     ```powershell
     git push origin --delete feat/<nombre-feature>
     ```
     *(Si la rama remota fue eliminada automáticamente por GitHub via `delete_branch_on_merge`, omitir este paso).*
8. **Poda de Referencias Obsoletas:**
   ```powershell
   git fetch --prune origin
   ```
9. **Registro Documental:** Consignar en el informe de cierre los SHAs auditados, el PR fusionado y la lista de ramas y worktrees retirados.

---

## 4. Condiciones de Seguridad y Elementos Expresamente Protegidos

### 4.1. Reglas de No Eliminación
Queda estrictamente prohibido eliminar automáticamente:
- Ramas con Pull Requests cerrados sin merge (salvo orden expresa tras integrarse por otra vía).
- Ramas con commits exclusivos o trabajo no volcado en `main` o `Dev`.
- Ramas activas actualmente en el repositorio principal o en cualquier worktree en uso.
- Worktrees con modificaciones o archivos sin guardar.
- Ramas de promoción en curso.

### 4.2. Elementos Inmutables
- `main` y `origin/main`.
- `Dev` y `origin/Dev`.
- El repositorio principal de trabajo (`Muro Partisiativo de Ideas`).
- La rama activa de trabajo en el repositorio principal.
- Archivos con modificaciones preexistentes (CRLF) y documentos de auditoría no versionados.
- Worktrees activos de infraestructura o desarrollo continuo (`muro-dev-export-html`, etc.).

---

## 5. Herramienta de Auditoría

El repositorio cuenta con la herramienta de diagnóstico informativo:
```powershell
node scripts/audit-feature-branches.cjs
```

Esta herramienta enumera ramas locales y remotas `feat/*`, consulta el estado de PRs en GitHub API, detecta worktrees asociados, clasifica las ramas en categorías (A: Aptas, B: Evaluar, C: Conservar, D: Dudoso) y emite recomendaciones de limpieza sin ejecutar operaciones destructivas.
