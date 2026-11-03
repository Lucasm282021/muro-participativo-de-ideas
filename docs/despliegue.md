# Despliegue y operación

## Topología actual

- El repositorio de GitHub conectado a Vercel es `Lucasm282021/muro-participativo-de-ideas`.
- La rama `main` despliega a Production; los cambios en otras ramas pueden crear Preview Deployments.
- Vercel ejecuta Next.js. La base de datos y Auth están en el proyecto Supabase de producción.
- Las migraciones de Supabase se versionan en `supabase/migrations/`; el push del código a Vercel no aplica migraciones SQL automáticamente.

El nombre y las cuentas de Vercel, GitHub y Supabase son servicios separados. El acceso a cada uno debe administrarse desde su proveedor. No guardes tokens de acceso en este repositorio.

## Variables de entorno

Configurar en **Vercel → Project → Settings → Environment Variables** para Production y Preview:

| Variable | Valor | Alcance |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase conectado. | Público; debe corresponder al mismo entorno que la clave. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key del proyecto Supabase. | Pública; RLS debe proteger el acceso. |

Las mismas variables se usan localmente en `.env.local`. `.env.example` muestra los nombres sin incluir credenciales reales. No copiar claves de otro proyecto ni subir `.env.local`. No agregar una clave `service_role` como `NEXT_PUBLIC_*`.

Al cambiar variables en Vercel, crear un nuevo deployment para que la compilación las reciba.

## Configuración de Supabase Auth

En **Supabase → Authentication → URL Configuration**:

- `Site URL` debe ser el dominio de producción, actualmente `https://muro-participativo-de-ideas.vercel.app`.
- Permitir `https://muro-participativo-de-ideas.vercel.app/**` como URL de retorno.
- Permitir `http://localhost:3000/**` para desarrollo local.
- Agregar cualquier dominio personalizado de producción y su URL de retorno antes de usarlo.

Los enlaces de confirmación y recuperación usan el dominio de la solicitud y el callback `/auth/callback`. La configuración local se versiona en `supabase/config.toml`. En producción, los correos los gestiona Supabase Auth; para entrega confiable y límites adecuados, configurar y revisar un proveedor SMTP en Supabase.

## Publicar una versión

### 1. Preparar cambios de base de datos

Crear una migración para cada cambio de esquema y validarla primero contra Supabase local:

```powershell
npx supabase migration new nombre_del_cambio
npm run supabase:start
npx supabase migration up --local
```

Revisar el SQL y el estado local antes de tocar producción. Si no hay cambios de esquema pendientes, no ejecutar `db push`.

### 2. Aplicar migraciones a producción cuando corresponda

Vincular la carpeta local al proyecto Supabase correcto (solo la primera vez por checkout) y revisar la lista que se va a aplicar:

```powershell
npx supabase link --project-ref <project-ref>
npx supabase migration list
npx supabase db push
```

`db push` solicita confirmación antes de aplicar migraciones. Verificar el nombre del proyecto y cada archivo listado. Hacer cambios aditivos cuando sea posible; las migraciones de borrado o transformación requieren una estrategia de conservación/restauración de datos.

### 3. Desplegar la aplicación

Los cambios hacia `main` deben integrarse mediante Pull Request auditado y aprobado en GitHub, respetando las protecciones del repositorio:

```powershell
git push origin <rama-de-trabajo>
```

Tras la aprobación del Pull Request y la verificación exitosa de las comprobaciones automatizadas (checks), ejecutar la fusión en GitHub. Vercel creará el despliegue de producción desde `main`. Revisar **Vercel → Deployments** y esperar el estado **Ready**. Para ramas previas o de desarrollo, comprobar el Preview antes de integrar el cambio.

## Comprobación posterior

Después de cada despliegue, revisar al menos:

1. La página inicial y `/ingresar` responden en el dominio de producción.
2. El flujo de ingreso y el panel funcionan con una cuenta organizadora existente.
3. Los correos de confirmación/recuperación retornan al dominio correcto y el callback completa el flujo.
4. Una actividad de prueba permite enviar una idea y mostrarla según su modo de moderación.
5. El muro público se actualiza en vivo sin mostrar email, nombre ni apellido.
6. Los logs de Vercel y Supabase no muestran errores inesperados.

No usar información personal real para las comprobaciones si una cuenta o actividad de prueba alcanza.

## Fallas y vuelta atrás

- Si falla una compilación, revisar los logs de Build en el deployment de Vercel; el deployment anterior Ready sigue siendo el destino público hasta que haya uno nuevo listo.
- Si un deployment nuevo presenta errores en la app, usar la opción de Vercel para volver a promover el deployment anterior conocido como bueno y corregir el código antes de publicar de nuevo.
- Volver atrás el código no revierte migraciones de base de datos. Las correcciones de esquema se hacen con una migración nueva. Antes de una operación destructiva, verificar que haya una copia de seguridad adecuada en Supabase.
- No ejecutar `supabase db reset` contra producción; el reset es para el entorno local.

## Entorno local

La preparación de Docker, URLs locales, Supabase Studio y la bandeja de email de prueba está en el [README](../README.md#preparar-el-entorno). Las cuentas locales y los datos locales son independientes de Production.

---

## Política permanente de cierre técnico de features y limpieza de ramas

Ninguna funcionalidad o rama `feat/*` se considera completada con la mera aprobación o fusión del Pull Request. Una feature está formalmente cerrada cuando su integración y despliegue están verificados en destino (`main` o `Dev`), y todos sus artefactos temporales (ramas locales, ramas remotas y worktrees dedicados) han sido retirados de forma segura.

### Configuración de GitHub
El repositorio tiene habilitada la directiva `delete_branch_on_merge: true`. Al fusionar un Pull Request en GitHub, la rama remota (`origin/feat/*` o `origin/promo/*`) se elimina automáticamente en el servidor. Esto **no** elimina ramas locales ni worktrees en las estaciones de trabajo.

### Procedimiento obligatorio de cierre técnico
Tras la fusión e integración de una rama:
1. **Verificación del PR:** Confirmar estado `closed` y `merged: true` en GitHub.
2. **Identificación de la rama destino:** Confirmar si el destino es `main` o `Dev`.
3. **Verificación de commits y contenido:**
   - *Merge commit:* Comprobar ancestría directa con `git merge-base --is-ancestor <rama> <destino>`.
   - *Squash and merge:* Comprobar el squash commit en la rama destino y que `git diff <rama> <destino>` no reporte cambios de la feature pendientes.
   - *Promoción conjunta:* Comprobar que todos los archivos de la feature quedaron incorporados en la rama de promoción integrada.
4. **Verificación de despliegue:** Confirmar estado `Ready` en Vercel para el commit resultante.
5. **Comprobación de worktree limpio:** Verificar que el worktree de la feature no contenga modificaciones sin guardar (`git status --short` vacío) y que no existan procesos activos.
6. **Retiro del worktree exclusivo:** Ejecutar `git worktree remove <ruta-worktree>`.
7. **Eliminación segura de ramas:**
   - Local: `git branch -d feat/<nombre>`.
   - Remota (si no fue eliminada por GitHub): `git push origin --delete feat/<nombre>`.
8. **Poda de referencias obsoletas:** Ejecutar `git fetch --prune origin`.
9. **Registro formal:** Dejar constancia documental en el informe de cierre de la feature.

Para más detalles operativos y resolución de casos especiales, consultar [docs/workflow-git.md](./workflow-git.md).
