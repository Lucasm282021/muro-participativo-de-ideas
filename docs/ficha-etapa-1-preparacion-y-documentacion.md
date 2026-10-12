# Ficha de Seguimiento — Etapa 1: Preparación y Documentación

**Fecha:** 12/10/2026  
**Rama de origen:** `main` (commit `4278c11`)  
**Rama de trabajo:** `feat/pagina-administracion`  
**Rama base de integración:** `develop`  
**Estado de la etapa:** Completada para revisión  
**Responsable:** Antigravity  

---

## 1. Objetivo y alcance de la etapa

Establecer la línea base de desarrollo para la implementación y optimización de la página de administración del Muro Participativo de Ideas (`/panel` y `/panel/actividad/[id]`), asegurando la integridad del repositorio, recuperando las especificaciones aprobadas, analizando el estado actual del código y delimitando las etapas de trabajo con criterios de aceptación verificables y auditoría de OpenCode como requisito de cierre.

### Alcance
- Inspección de solo lectura del repositorio y verificación de integridad de `main`.
- Creación de la rama de trabajo `feat/pagina-administracion` y de la rama base `develop`.
- Recuperación documental de las decisiones aprobadas y contraste contra el código existente.
- Diagnóstico del panel de organizador (`/panel`) y de la vista de actividad (`/panel/actividad/[id]`).
- Identificación de discrepancias, defectos y oportunidades de mejora en administración.
- Definición de un plan de trabajo delimitado por etapas con criterios de aceptación verificables y auditoría de OpenCode.

---

## 2. Decisiones aprobadas utilizadas como referencia

1. **Modelo de roles y seguridad:**
   - No existen roles de administrador global ni superusuarios (MVP acotado; `docs/arquitectura.md:78` y `docs/estado-actual-del-producto.md:160`).
   - Solo existen cuentas de organizadores autenticados mediante Supabase Auth.
   - Row Level Security (RLS) en PostgreSQL es la frontera de seguridad estricta: aísla actividades, participantes, ideas y autorías mediante `owner_id = auth.uid()`.
2. **Ciclo de vida de la actividad:**
   - Estados: `draft`, `open`, `closed`.
   - Modos de moderación: `automatic` (las ideas se publican de inmediato) y `approval` (las ideas quedan `pending` hasta ser aprobadas).
   - Código público aleatorio de 8 caracteres alfanuméricos en mayúsculas `^[A-Z0-9]{8}$`.
   - Cierre y reapertura controlados por el organizador (`toggleActivityAction`).
   - Eliminación en cascada destructiva e irreversible (`deleteActivityAction`).
3. **Privacidad de participantes y autores:**
   - La tabla `participants` y la relación `idea_authors` solo son legibles por el organizador dueño de la actividad.
   - La pantalla pública del muro (`/muro/[code]`) y los payloads de Realtime no transportan datos personales.
4. **Acceso y compartición:**
   - QR descargable en PNG (256 × 256 px) con isotipo `/muro-mark.svg`.
   - Enlace y QR adaptados dinámicamente al origen efectivo del navegador.

---

## 3. Inventario del panel existente y análisis de brechas

### 3.1 Funcionalidades existentes verificadas
- **`/panel` (Listado y creación):**
  - Autenticación protegida con redirección a `/ingresar`.
  - Encabezado con correo del usuario y botón de cerrar sesión (`signOutAction`).
  - Formulario de creación de actividad (`ActivityForm`) con validación Zod, título (1-120 chars), consigna (1-300 chars) y selector de modo de moderación inicial.
  - Historial de actividades (`ActivityCard`) ordenadas por fecha descendente con estados visibles y enlaces de acceso.
  - Estado vacío descriptivo cuando no hay actividades.
- **`/panel/actividad/[id]` (Detalle y control de actividad):**
  - Validación de existencia y propiedad de la actividad (`maybeSingle()` + RLS).
  - Encabezado con estado, código público, título y consigna.
  - Enlaces directos para abrir el formulario público (`/a/[code]`) y el muro (`/muro/[code]`).
  - Componente `ShareQrPanel` con visualización de QR, descarga de PNG, copia de enlace, compartir nativo y contadores de participantes e ideas.
  - Control para cerrar y reabrir la recepción de ideas (`toggleActivityAction`).
  - Sección de moderación con contador de pendientes y tarjetas con fecha formateada.
  - Sección de participantes con iniciales de avatar, nombre y correo.
  - Selector de modo de publicación en franja inferior (`setModerationModeAction`).
  - Botón de eliminación de actividad con confirmación modal (`DeleteActivityButton`).

### 3.2 Brechas y discrepancias detectadas frente al alcance aprobado
1. **Moderación bloqueada en modo automático:**
   - En `ActivityDetailPage`, las acciones de moderación están condicionadas estrictamente a `{activity.moderation_mode === "approval" && ...}`. En consecuencia, si una actividad está configurada en modo automático (`automatic`), el organizador no tiene botones para ocultar del muro una idea inapropiada que ya se haya publicado.
2. **Inconsistencia terminológica ("charla" vs "actividad" / "conversación"):**
   - En `DeleteActivityButton` se utiliza el texto "Eliminar charla" y "¿Eliminar la charla...?", y en `actions.ts:343` "No pudimos eliminar la charla...". El término unificado en la documentación y el resto de la interfaz es "actividad" o "conversación".
3. **Falta de retroalimentación de estado de carga (UX):**
   - El cambio de modo de publicación (`setModerationModeAction`) y el cambio de estado de apertura (`toggleActivityAction`) no implementan indicadores visuales de progreso (`pending` / spinner), a diferencia de `ActivityForm` y `DeleteActivityButton`.
   - Las acciones de moderar ideas (`moderateIdeaAction`) se ejecutan mediante formularios individuales por botón sin estado de carga ni feedback inmediato.
4. **Actualización en tiempo real en la pantalla del organizador:**
   - La pantalla `/panel/actividad/[id]` es un Server Component sin suscripción Realtime: no refleja nuevas ideas o participantes hasta que el organizador recarga manualmente la página.
5. **Manejo de errores silenciosos:**
   - `moderateIdeaAction` y `setModerationModeAction` retornan silenciosamente ante fallos de validación sin notificar al usuario.

---

## 4. Tareas realizadas en la Etapa 1
- [x] Inspección de solo lectura del repositorio y confirmación del árbol limpio en commit `4278c11`.
- [x] Creación de la rama `feat/pagina-administracion` a partir de `main` (commit `4278c11`).
- [x] Creación de la rama base `develop` a partir de `main` (commit `4278c11`).
- [x] Preservación de la rama `main` y del repositorio remoto sin push ni despliegues.
- [x] Revisión de convenciones documentales en `docs/`.
- [x] Creación de la ficha de seguimiento de la Etapa 1 (`docs/ficha-etapa-1-preparacion-y-documentacion.md`).
- [x] Análisis exhaustivo de `/panel`, `/panel/actividad/[id]`, Server Actions y componentes asociados.
- [x] Detección y documentación de brechas funcionales y de UX.
- [x] Formulación del plan de trabajo estructurado por etapas.
- [x] Ejecución de comprobaciones técnicas de solo lectura (`tsc`, `biome`).

---

## 5. Resultados reales de las verificaciones técnicas

| Verificación | Comando | Resultado real | Observaciones |
| :--- | :--- | :--- | :--- |
| Verificación de tipos | `npx tsc --noEmit` | ✅ Exit code 0 | Tipos consistentes en todo el proyecto; sin errores de TypeScript. |
| Verificación de formato y linter | `npx biome check` | ⚠️ 1 advertencia de formato | 35 archivos revisados. Se detectó 1 diferencia de formateo en `src/components/live-wall.tsx:781` preexistente en `main`. Ningún error de sintaxis ni reglas de linter violadas. |
| Estado de Git | `git status` | ✅ Árbol controlado | Sin cambios en archivos de código funcional. Únicamente archivos documentales de seguimiento en el directorio de trabajo. |

---

## 6. Estado final de Git y trazabilidad

- **`main`:** Intacta en commit `4278c11` (sincronizada con `origin/main`).
- **`develop`:** Creada desde `main` (`4278c11`), destinada a recibir las integraciones validadas.
- **`feat/pagina-administracion`:** Creada desde `main` (`4278c11`), rama designada para la implementación funcional.
- **Trazabilidad de la ficha:** La ficha de seguimiento reside como archivo en el directorio de trabajo; no ha sido commiteada para cumplir con la restricción de no crear commits sin autorización expresa.

---

## 7. Criterios de aceptación de la Etapa 1

1. **Aislamiento de rama:** Rama de desarrollo y rama de feature creadas a partir de la línea base estable `4278c11`.
2. **Integridad de `main`:** Ningún commit ni push sobre `main`.
3. **Documentación establecida:** Ficha de seguimiento creada sin alterar código funcional.
4. **Contraste completado:** Inventario de funcionalidades existentes y brechas detectadas documentado con precisión.
5. **Plan de trabajo delimitado:** Etapas definidas con criterios verificables y auditoría de OpenCode.
