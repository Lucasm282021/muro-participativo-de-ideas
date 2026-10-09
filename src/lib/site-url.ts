import { headers } from "next/headers";

/**
 * Obtiene la URL base de la aplicación.
 * Prioridad:
 * 1. Headers de la petición HTTP (x-forwarded-host / host) -> funciona tanto en Vercel
 *    (producción y preview branches) como en local y redes locales.
 * 2. NEXT_PUBLIC_SITE_URL si está definido en variables de entorno.
 * 3. VERCEL_PROJECT_PRODUCTION_URL o VERCEL_URL automáticas de Vercel.
 * 4. Fallback a http://localhost:3000.
 */
export async function getBaseUrl(): Promise<string> {
  try {
    const headerStore = await headers();
    const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");

    if (host) {
      const proto =
        headerStore.get("x-forwarded-proto") ??
        (host.startsWith("localhost") || host.startsWith("127.0.0.1")
          ? "http"
          : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // headers() puede fallar si se invoca fuera del ciclo de una petición HTTP
  }

  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}
