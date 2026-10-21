# Muro común

Aplicación web adaptable para que un organizador cree actividades, reciba ideas y las muestre en un muro en vivo. El MVP funciona en navegador; todavía no incluye manifiesto ni modo instalable PWA.

## Qué incluye el MVP

- Registro e inicio de sesión de organizadores con Supabase Auth.
- Creación, moderación, cierre, reapertura y eliminación de actividades.
- Participación sin cuenta, con nombre, apellido, email e idea.
- Publicación automática o con aprobación del organizador.
- Muro público con ideas aprobadas y actualización en tiempo real.
- Acceso compartible por enlace y QR con la marca del proyecto, descargable en PNG.
- Recuperación de contraseña por email.

## Documentación

- [Arquitectura y decisiones técnicas](docs/arquitectura.md)
- [Modelo de datos y permisos](docs/modelo-de-datos.md)
- [Despliegue y operación en Vercel](docs/despliegue.md)

## Requisitos locales

- Node.js 20.9 o posterior y npm.
- Docker Desktop iniciado con backend WSL 2.
- Git para obtener el proyecto.

## Preparar el entorno

```bash
npm install
npm run supabase:start
```

Al iniciar Supabase local, copiá el API URL y la publishable key que informa la CLI a un archivo `.env.local` en la raíz:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:25435
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=tu_publishable_key_local
```

`.env.local` no debe subirse a Git. `.env.example` documenta los nombres requeridos para conectar otro proyecto Supabase. No agregues una clave `service_role` a variables `NEXT_PUBLIC_*` ni al navegador.

## Ejecutar

En una terminal, desde la raíz del repositorio:

```bash
npm run dev
```

- Aplicación: <http://localhost:3000>
- Supabase Studio: <http://127.0.0.1:25434>
- Bandeja local de emails de prueba: <http://127.0.0.1:25436>
- API local: <http://127.0.0.1:25435>

Creá el primer organizador en `/crear-cuenta`. En Supabase local la confirmación de email está desactivada. Los enlaces de recuperación enviados localmente se consultan en la bandeja de prueba; no se envían a Internet.

Para detener los servicios locales:

```bash
npm run supabase:stop
```

`npm run supabase:status` muestra el estado de Supabase. Las migraciones viven en `supabase/migrations/`; los cambios de esquema deben expresarse como migraciones y aplicarse primero en local.

## Comandos habituales

```bash
npm run dev
npm run build
npm run lint
npm run supabase:start
npm run supabase:stop
npm run supabase:status
```

Para desplegar o actualizar producción, seguí [la guía de Vercel](docs/despliegue.md). No subas `.env.local`, tokens, contraseñas ni archivos temporales de Supabase.
