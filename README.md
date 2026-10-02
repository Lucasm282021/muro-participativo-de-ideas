# Muro participativo de ideas

Aplicación web progresiva para crear actividades, recibir ideas y mostrarlas en una pantalla común.

## Entorno local

### Requisitos

- Node.js 20.9 o posterior y npm.
- Docker Desktop funcionando con backend WSL 2.

### Preparar

```bash
npm install
```

Las variables locales de Supabase están en `.env.local` (no se sube a Git). `.env.example` muestra los nombres esperados.

Si Supabase ya estaba iniciado antes de agregar una migración, aplicala con:

```bash
npx supabase migration up --local
```

### Ejecutar

```bash
npm run supabase:start
npm run dev
```

- Aplicación: <http://localhost:3000>
- Supabase Studio: <http://127.0.0.1:54323>
- API local: <http://127.0.0.1:54321>

Para detener Supabase:

```bash
npm run supabase:stop
```

`npm run supabase:status` muestra el estado de los servicios locales. Las migraciones de base de datos se guardan en `supabase/migrations/`.
