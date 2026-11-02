# Despliegue, Operación y Gestión de Entornos

---

## 1. Topología del Sistema y Servicios Conectados

- **Repositorio oficial en GitHub:** `Lucasm282021/muro-participativo-de-ideas`.
- **Ramas:**
  - `main`: Rama de producción (actualmente en commit `cd94282`).
  - `Dev`: Rama activa de integración y desarrollo (actualmente en commit local `dbc2f35`).
- **Plataforma de Hosting:** Vercel. Despliega automáticamente compilaciones desde GitHub.
- **Base de datos e Identidad:** Proyecto gestionado en Supabase Cloud (PostgreSQL 15+, Auth, Realtime).
- **Independencia operativa:** El despliegue de código en Vercel **no ejecuta migraciones SQL de forma automática**. Las migraciones deben gestionarse de manera independiente y controlada mediante Supabase CLI.

---

## 2. Discrepancia Crítica de Dominios de Producción

> [!WARNING]
> **ESTADO: PENDIENTE DE CONFIRMACIÓN.**
> La auditoría técnica identificó discrepancias respecto del dominio canónico de producción:
> - **Dominio A:** `https://murocomun.vercel.app` (configurado en `.env.production`, scripts de pruebas y cabeceras de validación).
> - **Dominio B:** `https://muro-participativo-de-ideas.vercel.app` (mencionado previamente en documentación histórica como `Site URL` de Auth).
> - **URL de Preview activa:** `https://muro-participativo-de-ideas-aw6gfa7p9-kritio-systems.vercel.app` (asociada al scope institucional `kritio-systems` con autenticación SSO de Vercel).
>
> **Regla operativa obligatoria:** Queda expresamente prohibido elegir o asumir uno de los dominios sin verificación previa directa en el panel de control de Vercel y en la configuración de URLs de Supabase Auth.

---

## 3. Variables de Entorno Requeridas

Las siguientes variables deben estar configuradas en **Vercel → Project → Settings → Environment Variables** (para los entornos de *Production* y *Preview*):

| Variable | Tipo / Alcance | Propósito |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Pública (`NEXT_PUBLIC_*`) | URL del proyecto Supabase enlazado. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Pública (`NEXT_PUBLIC_*`) | Clave pública de acceso (restringida mediante RLS). |

> [!CAUTION]
> **Protección de secretos:**
> - Jamás debe configurarse la clave `service_role` en Vercel como variable pública ni en el archivo `.env.local`.
> - Las credenciales sintéticas de prueba (`SYNTHETIC_ADMIN_*`, etc.) son de uso exclusivo en entornos locales y jamás deben subirse al repositorio ni configurarse en producción.

---

## 4. Estado de Migraciones y Procedimiento de Base de Datos

### 4.1. Incertidumbre del estado de producción
- Las migraciones `1` a `7` se encuentran confirmadas en el entorno productivo.
- Las migraciones `20261021140000_audit_cascade_counts_v2.sql`, `20261028150000_ideas_atomic_numbering.sql` y `20261029170000_export_activity_ideas_rpc.sql` se encuentran aplicadas en la base local, pero su aplicación en producción es **ESTRICTAMENTE DESCONOCIDA** (sin telemetría comprobable).
- Además, la migración `20261029170000` fue aplicada localmente sin constancia documental de autorización previa.

### 4.2. Procedimiento obligatorio previo a cualquier migración productiva
1. Vincular el CLI local al proyecto de producción correspondiente:
   ```powershell
   npx supabase link --project-ref <PROJECT_REF>
   ```
2. Inspeccionar en modo solo lectura las diferencias de migraciones:
   ```powershell
   npx supabase migration list
   ```
3. **No ejecutar `supabase db push`** sin autorización formal, respaldo verificado de la base de datos de producción y plan de contingencia documentado.
4. **NUNCA ejecutar `supabase db reset`** contra el entorno de producción (comando reservado exclusivamente para desarrollo local con Docker).

---

## 5. Compilación y Despliegue de la Aplicación

### 5.1. Consideración técnica de compilación en Windows
En entornos de desarrollo Windows con espacios en la ruta del repositorio (`Muro Partisiativo de Ideas`), Turbopack falla en la resolución interna de PostCSS. Para compilar y validar de manera determinista se debe utilizar el compilador nativo Webpack:

```powershell
npx next build --webpack
```

### 5.2. Flujo de despliegue a producción
1. Verificar que la rama `Dev` cuente con todas las pruebas aprobadas (`node --test tests/...`, `npx tsc --noEmit`).
2. Resolver la sincronización de base de datos (§4).
3. Integrar los cambios hacia `main` mediante Pull Request auditado:
   ```powershell
   git checkout main
   git merge Dev --ff-only
   git push origin main
   ```
4. Monitorear el despliegue automático en la consola de Vercel hasta alcanzar el estado `Ready`.

---

## 6. Lista de Verificación Posterior al Despliegue (Smoke Test)

Tras cada despliegue a producción, validar obligatoriamente los 5 flujos fundamentales:

1. **Ruta inicial y autenticación:** Acceder a la portada y verificar que `/ingresar` responda HTTP 200 sin errores de consola.
2. **Panel de organizador:** Iniciar sesión con una cuenta de prueba, verificar la visualización correcta de `/panel` y abrir el detalle `/panel/actividad/[id]`.
3. **Ergonomía y scroll del panel:** Comprobar que el detalle de actividad tenga distribución vertical fluida, scroll completo y acceso a la zona de peligro.
4. **Participación móvil:** Abrir `/a/[code]` en un dispositivo móvil o emulador, enviar una idea de prueba y comprobar la respuesta del servidor.
5. **Muro en tiempo real:** Proyectar `/muro/[code]` en pantalla completa y constatar que la idea ingresada se presente como destacada (8s) y luego se incorpore armónicamente a la grilla.
