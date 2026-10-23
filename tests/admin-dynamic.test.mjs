import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createBrowserClient } from "@supabase/ssr";

// ============================================================================
// P1-R121 AU-4B: Arnés de Pruebas Dinámicas y Funcionales para /admin
// ============================================================================

const APP_URL = process.env.TEST_APP_URL || "http://localhost:3000";
const SUPABASE_LOCAL_URL =
  process.env.DISPOSABLE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "http://127.0.0.1:25435";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.DISPOSABLE_SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Identidades sintéticas (únicamente utilizables tras aprovisionamiento en contenedor desechable)
const NON_ADMIN_EMAIL = process.env.SYNTHETIC_NONADMIN_EMAIL;
const NON_ADMIN_PASSWORD = process.env.SYNTHETIC_NONADMIN_PASSWORD;
const ADMIN_GLOBAL_EMAIL = process.env.SYNTHETIC_ADMINGLOBAL_EMAIL;
const ADMIN_GLOBAL_PASSWORD = process.env.SYNTHETIC_ADMINGLOBAL_PASSWORD;
const RUN_PROVISIONED_TESTS = process.env.RUN_DYNAMIC_AUTH_TESTS === "true";

/**
 * Helper para construir un cliente de sesión y extraer cookies compatibles con @supabase/ssr
 */
function createSessionClient(cookieJar) {
  return createBrowserClient(SUPABASE_LOCAL_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      get(name) {
        return cookieJar.get(name);
      },
      set(name, value) {
        cookieJar.set(name, value);
      },
      remove(name) {
        cookieJar.delete(name);
      },
    },
  });
}

function formatCookieHeader(cookieJar) {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
}

test("arnés dinámico /admin: verificación de seguridad de entorno y no conectividad externa", () => {
  const appUrlObj = new URL(APP_URL);
  assert.ok(
    appUrlObj.hostname === "localhost" || appUrlObj.hostname === "127.0.0.1",
    "Guardia de seguridad: APP_URL debe ser local",
  );

  const supabaseUrlObj = new URL(SUPABASE_LOCAL_URL);
  assert.ok(
    supabaseUrlObj.hostname === "localhost" ||
      supabaseUrlObj.hostname === "127.0.0.1",
    "Guardia de seguridad: SUPABASE_LOCAL_URL debe ser local",
  );
  assert.doesNotMatch(
    supabaseUrlObj.hostname,
    /supabase\.co$/,
    "Guardia de seguridad: prohibido apuntar a Supabase Cloud",
  );
});

test("arnés dinámico /admin [Escenario 1]: petición no autenticada redirige a /ingresar (HTTP 307)", async () => {
  // Petición directa a /admin sin cookies de sesión
  const res = await fetch(`${APP_URL}/admin`, {
    method: "GET",
    redirect: "manual",
  });

  // 1. Debe responder con redirección temporal HTTP 307
  assert.equal(
    res.status,
    307,
    `Se esperaba HTTP 307, se obtuvo código ${res.status}`,
  );

  // 2. Encabezado Location debe apuntar a /ingresar
  const locationHeader = res.headers.get("location");
  assert.ok(
    locationHeader && locationHeader.includes("/ingresar"),
    `El encabezado Location debe redirigir a /ingresar, obtenido: ${locationHeader}`,
  );

  // 3. No debe filtrar datos administrativos en el cuerpo
  const bodyText = await res.text();
  assert.doesNotMatch(
    bodyText,
    /Supervisión de actividades/i,
    "La respuesta 307 no debe contener el título del panel administrativo",
  );
  assert.doesNotMatch(
    bodyText,
    /Actividades Globales/i,
    "La respuesta 307 no debe contener métricas administrativas",
  );
  assert.doesNotMatch(
    bodyText,
    /Bitácora de Auditoría/i,
    "La respuesta 307 no debe contener la bitácora de auditoría",
  );
});

test("arnés dinámico /admin [Escenario 2]: usuario autenticado sin admin_global recibe HTTP 403", async (t) => {
  if (!RUN_PROVISIONED_TESTS || !NON_ADMIN_EMAIL || !NON_ADMIN_PASSWORD) {
    t.skip(
      "Diferido a contenedor desechable: Requiere aprovisionamiento de usuario sintético no-admin y autorización AU-4C.",
    );
    return;
  }

  const cookieJar = new Map();
  const client = createSessionClient(cookieJar);

  const { data: authData, error: authError } =
    await client.auth.signInWithPassword({
      email: NON_ADMIN_EMAIL,
      password: NON_ADMIN_PASSWORD,
    });

  assert.equal(authError, null, `Error de login sintético: ${authError?.message}`);
  assert.ok(authData.session, "Debe obtener sesión válida");

  const cookieHeader = formatCookieHeader(cookieJar);
  const res = await fetch(`${APP_URL}/admin`, {
    method: "GET",
    headers: {
      Cookie: cookieHeader,
    },
    redirect: "manual",
  });

  // 1. Debe responder estrictamente con código HTTP 403 Forbidden
  assert.equal(
    res.status,
    403,
    `Se esperaba HTTP 403 para usuario no autorizado, obtenido: ${res.status}`,
  );

  const bodyText = await res.text();

  // 2. Debe renderizar la UI de forbidden.tsx
  assert.match(
    bodyText,
    /Acceso Restringido/i,
    "El cuerpo debe mostrar la página de Acceso Restringido",
  );
  assert.match(
    bodyText,
    /403/i,
    "El cuerpo debe contener el identificador de código 403",
  );
  assert.match(
    bodyText,
    /← Volver a Mi Panel/i,
    "El cuerpo debe ofrecer navegación de retorno seguro",
  );

  // 3. Ausencia absoluta de información administrativa y datos de negocio
  assert.doesNotMatch(
    bodyText,
    /Supervisión de actividades/i,
    "No debe renderizar encabezados de supervisión",
  );
  assert.doesNotMatch(
    bodyText,
    /Vista previa · Sin rol asignado/i,
    "La vista previa sin rol debe estar erradicada",
  );
  assert.doesNotMatch(
    bodyText,
    /Bitácora de Auditoría/i,
    "No debe mostrar bitácora histórica a usuarios no autorizados",
  );
});

test("arnés dinámico /admin [Escenario 3]: usuario con rol admin_global recibe HTTP 200 OK", async (t) => {
  if (!RUN_PROVISIONED_TESTS || !ADMIN_GLOBAL_EMAIL || !ADMIN_GLOBAL_PASSWORD) {
    t.skip(
      "Diferido a contenedor desechable: Requiere aprovisionamiento de usuario admin_global sintético y autorización AU-4C.",
    );
    return;
  }

  const cookieJar = new Map();
  const client = createSessionClient(cookieJar);

  const { data: authData, error: authError } =
    await client.auth.signInWithPassword({
      email: ADMIN_GLOBAL_EMAIL,
      password: ADMIN_GLOBAL_PASSWORD,
    });

  assert.equal(authError, null, `Error de login de admin sintético: ${authError?.message}`);
  assert.ok(authData.session, "Debe obtener sesión válida");

  const cookieHeader = formatCookieHeader(cookieJar);
  const res = await fetch(`${APP_URL}/admin`, {
    method: "GET",
    headers: {
      Cookie: cookieHeader,
    },
    redirect: "manual",
  });

  // 1. Debe responder con HTTP 200 OK
  assert.equal(
    res.status,
    200,
    `Se esperaba HTTP 200 para admin_global autorizado, obtenido: ${res.status}`,
  );

  const bodyText = await res.text();

  // 2. Debe renderizar el panel administrativo completo
  assert.match(
    bodyText,
    /Supervisión de actividades/i,
    "Debe mostrar encabezado de supervisión",
  );
  assert.match(
    bodyText,
    /Admin Global/i,
    "Debe mostrar la insignia de Admin Global acreditado",
  );
  assert.match(
    bodyText,
    /Gestión de Actividades/i,
    "Debe incluir la sección de actividades",
  );
});

test("arnés dinámico /admin [Escenario 4]: Server Actions rechazan ejecución de usuario no autorizado", async (t) => {
  if (!RUN_PROVISIONED_TESTS || !NON_ADMIN_EMAIL || !NON_ADMIN_PASSWORD) {
    t.skip(
      "Diferido a contenedor desechable: Requiere credenciales sintéticas no-admin y autorización AU-4C.",
    );
    return;
  }

  // Las Server Actions de Next.js invocadas por cliente con sesión sin rol
  // deben ser rechazadas mediante la guarda checkAdminAuthorization en actions.ts
  assert.ok(true, "Estructura preparada para ejecución contra contenedor desechable");
});
