import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { generateCsv } from "../src/lib/export/csv.ts";
import { generateHtmlSlideDeck } from "../src/lib/export/html.ts";
import {
  exportQuerySchema,
  exportRpcResponseSchema,
  MAX_EXPORT_LIMIT,
} from "../src/lib/export/schemas.ts";

// Cargar y transpilar el handler real de route.ts
const routeUrl = new URL(
  "../src/app/panel/actividad/[id]/exportar/route.ts",
  import.meta.url,
);
const routeSource = fs.readFileSync(routeUrl, "utf8");

const jsCode = ts.transpileModule(routeSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const fnCode = jsCode;
const routeMod = { exports: {} };
const runner = new Function("module", "exports", "require", fnCode);

// Simular NextResponse compatible con Web Response estándar
class MockNextResponse extends Response {
  static json(data, init = {}) {
    const body = JSON.stringify(data);
    const headers = new Headers(init.headers || {});
    headers.set("content-type", "application/json");
    return new MockNextResponse(body, { ...init, headers });
  }
}

runner(routeMod, routeMod.exports, (name) => {
  if (name.includes("next/server")) return { NextResponse: MockNextResponse };
  if (name.includes("export/csv")) return { generateCsv };
  if (name.includes("export/html")) return { generateHtmlSlideDeck };
  if (name.includes("export/schemas"))
    return { exportQuerySchema, exportRpcResponseSchema, MAX_EXPORT_LIMIT };
  if (name.includes("supabase/server")) return { createClient: () => {} };
  return {};
});

const { GET } = routeMod.exports;

/**
 * Cliente Supabase simulado con captura de llamadas a RPC y verificación
 * de ausencia absoluta de consultas a tablas directas.
 */
function createMockSupabase({
  currentUser = { id: "user-organizer-1", email: "organizer@test.com" },
  rpcHandler = null,
} = {}) {
  const rpcCalls = [];
  const fromCalls = [];

  return {
    rpcCalls,
    fromCalls,
    auth: {
      getUser: async () => ({
        data: { user: currentUser },
        error: null,
      }),
    },
    rpc: async (fn, params) => {
      rpcCalls.push({ fn, params });
      if (rpcHandler) {
        return rpcHandler(fn, params);
      }
      return {
        data: null,
        error: {
          code: "42883",
          message: "function export_activity_ideas does not exist",
        },
      };
    },
    from: (table) => {
      fromCalls.push(table);
      throw new Error(
        `Acceso prohibido: se intentó consultar la tabla directa '${table}'`,
      );
    },
  };
}

const defaultActivity = {
  id: "act-123",
  public_code: "TESTCODE",
  title: "Actividad de Prueba",
  question: "¿Qué propones para mejorar el barrio?",
  status: "open",
  created_at: "2026-10-29T10:00:00Z",
};

// ============================================================================
// ESCENARIOS OBLIGATORIOS (1 a 12)
// ============================================================================

test("ESC-01: Actividad vacía (0 ideas) retorna snapshot atómico 200 OK en CSV y HTML", async () => {
  const supabase = createMockSupabase({
    rpcHandler: async (fn, params) => {
      assert.equal(fn, "export_activity_ideas");
      assert.equal(params.target_activity_id, "act-123");
      return {
        data: {
          activity: defaultActivity,
          ideas: [],
          total: 0,
        },
        error: null,
      };
    },
  });

  // CSV con 0 ideas
  const reqCsv = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
  );
  const resCsv = await GET(
    reqCsv,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );
  assert.equal(resCsv.status, 200);
  const csvText = await resCsv.text();
  assert.ok(csvText.includes('"Fecha de publicación"'));
  assert.equal(
    supabase.fromCalls.length,
    0,
    "No debe consultar tablas directas",
  );

  // HTML con 0 ideas
  const reqHtml = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=html",
  );
  const resHtml = await GET(
    reqHtml,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );
  assert.equal(resHtml.status, 200);
  const htmlText = await resHtml.text();
  assert.ok(htmlText.includes("Total de ideas</span>"));
  assert.ok(htmlText.includes("0"));
});

test("ESC-02A: Exportación íntegra de colección permitida (1.500 ideas) en CSV y HTML", async () => {
  const count = 1500;
  const ideasList = Array.from({ length: count }, (_, i) => ({
    id: `idea-${i + 1}`,
    content: `Propuesta vecinal número ${i + 1}`,
    status: "published",
    created_at: new Date(Date.now() + i * 1000).toISOString(),
    published_at: new Date(Date.now() + i * 1000).toISOString(),
  }));

  const supabase = createMockSupabase({
    rpcHandler: async () => ({
      data: {
        activity: defaultActivity,
        ideas: ideasList,
        total: count,
      },
      error: null,
    }),
  });

  const req = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
  );
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );

  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.ok(csv.includes("Propuesta vecinal número 1"));
  assert.ok(csv.includes("Propuesta vecinal número 1500"));
  assert.equal(supabase.fromCalls.length, 0);
});

test("ESC-02B: Exactamente 5.000 ideas permitidas -> 200 OK íntegro", async () => {
  const count = 5000;
  const ideasList = Array.from({ length: count }, (_, i) => ({
    id: `idea-5k-${i + 1}`,
    content: `Idea número ${i + 1}`,
    status: "published",
    created_at: "2026-10-29T10:00:00Z",
    published_at: "2026-10-29T10:00:00Z",
  }));

  const supabase = createMockSupabase({
    rpcHandler: async () => ({
      data: {
        activity: defaultActivity,
        ideas: ideasList,
        total: count,
      },
      error: null,
    }),
  });

  const req = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
  );
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );

  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.ok(csv.includes("Idea número 1"));
  assert.ok(csv.includes("Idea número 5000"));
});

test("ESC-03: Desbordamiento de 5.000 ideas (>5.000) retorna HTTP 413 Payload Too Large", async () => {
  const supabase = createMockSupabase({
    rpcHandler: async () => ({
      data: {
        error: "payload_too_large",
        total: 5001,
        limit: 5000,
      },
      error: null,
    }),
  });

  const req = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
  );
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );

  assert.equal(res.status, 413);
  const json = await res.json();
  assert.equal(json.error, "payload_too_large");
  assert.equal(json.total, 5001);
  assert.equal(supabase.fromCalls.length, 0);
});

test("ESC-04: Usuario no autenticado (sin sesión Supabase) retorna HTTP 401 sin invocar RPC", async () => {
  const supabase = createMockSupabase({ currentUser: null });

  const req = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
  );
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );

  assert.equal(res.status, 401);
  assert.equal(supabase.rpcCalls.length, 0, "No debe llamar a la RPC");
  assert.equal(supabase.fromCalls.length, 0, "No debe consultar tablas");
});

test("ESC-05: Error 42501 (permiso denegado / no autenticado) en RPC retorna HTTP 401", async () => {
  const supabase = createMockSupabase({
    rpcHandler: async () => ({
      data: null,
      error: { code: "42501", message: "unauthorized" },
    }),
  });

  const req = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
  );
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );

  assert.equal(res.status, 401);
  assert.equal(supabase.fromCalls.length, 0);
});

test("ESC-06: Error P0002 (actividad no encontrada o ajena) en RPC retorna HTTP 404", async () => {
  const supabase = createMockSupabase({
    rpcHandler: async () => ({
      data: null,
      error: { code: "P0002", message: "Activity not found" },
    }),
  });

  const req = new Request(
    "http://localhost:3000/panel/actividad/act-999/exportar?format=csv",
  );
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "act-999" }) },
    supabase,
  );

  assert.equal(res.status, 404);
  assert.equal(supabase.fromCalls.length, 0);
});

test("ESC-07: Error inesperado de base de datos (XX000) en RPC retorna HTTP 500", async () => {
  const supabase = createMockSupabase({
    rpcHandler: async () => ({
      data: null,
      error: { code: "XX000", message: "disk failure" },
    }),
  });

  const req = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
  );
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );

  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.error, "database_error");
  assert.equal(supabase.fromCalls.length, 0);
});

test("ESC-08: RPC inexistente (42883 / PGRST202) retorna HTTP 503 sin recurrir a fallback de tablas", async () => {
  // Caso 1: Código 42883 (función inexistente en PostgreSQL)
  const supabase42883 = createMockSupabase({
    rpcHandler: async () => ({
      data: null,
      error: {
        code: "42883",
        message: "function export_activity_ideas does not exist",
      },
    }),
  });

  const res42883 = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabase42883,
  );

  assert.equal(res42883.status, 503);
  const json42883 = await res42883.json();
  assert.equal(json42883.error, "export_service_unavailable");
  assert.equal(
    supabase42883.fromCalls.length,
    0,
    "Prohibido terminantemente consultar tablas",
  );

  // Caso 2: Código PGRST202 (función no encontrada en esquema de PostgREST)
  const supabasePgrst = createMockSupabase({
    rpcHandler: async () => ({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function in the schema",
      },
    }),
  });

  const resPgrst = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabasePgrst,
  );

  assert.equal(resPgrst.status, 503);
  const jsonPgrst = await resPgrst.json();
  assert.equal(jsonPgrst.error, "export_service_unavailable");
  assert.equal(
    supabasePgrst.fromCalls.length,
    0,
    "Prohibido terminantemente consultar tablas",
  );
});

test("ESC-09: Respuesta RPC malformada o inválida bajo contrato Zod retorna HTTP 500", async () => {
  // Respuesta sin la estructura esperada (por ejemplo falta actividad o status inválido)
  const supabaseMalformed = createMockSupabase({
    rpcHandler: async () => ({
      data: {
        activity: {
          id: "act-123",
          // Falta public_code, question, title, etc.
          status: "estado_desconocido",
        },
        ideas: "no_es_un_array",
        total: "no_es_un_numero",
      },
      error: null,
    }),
  });

  const res = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabaseMalformed,
  );

  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.error, "export_contract_error");
  assert.equal(supabaseMalformed.fromCalls.length, 0);
});

test("ESC-10: Discrepancia entre total declarado y cantidad de registros recibidos retorna HTTP 500", async () => {
  // La RPC devuelve total = 5, pero la lista de ideas contiene solo 4 registros
  const fourIdeas = Array.from({ length: 4 }, (_, i) => ({
    id: `idea-${i + 1}`,
    content: `Idea ${i + 1}`,
    status: "published",
    created_at: "2026-10-29T10:00:00Z",
    published_at: "2026-10-29T10:00:00Z",
  }));

  const supabaseInconsistent = createMockSupabase({
    rpcHandler: async () => ({
      data: {
        activity: defaultActivity,
        ideas: fourIdeas,
        total: 5, // Discrepancia intencional
      },
      error: null,
    }),
  });

  const res = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabaseInconsistent,
  );

  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.error, "export_contract_error");
  assert.ok(json.message.includes("Inconsistencia"));
  assert.equal(supabaseInconsistent.fromCalls.length, 0);
});

test("ESC-11: Alcance de exportación (published vs all) transmite parámetro exacto y refleja estados", async () => {
  let receivedScope = null;
  const mixedIdeas = [
    {
      id: "idea-pub",
      content: "Idea publicada",
      status: "published",
      created_at: "2026-10-29T10:00:00Z",
      published_at: "2026-10-29T10:05:00Z",
    },
    {
      id: "idea-pen",
      content: "Idea pendiente",
      status: "pending",
      created_at: "2026-10-29T10:01:00Z",
      published_at: null,
    },
    {
      id: "idea-hid",
      content: "Idea oculta",
      status: "hidden",
      created_at: "2026-10-29T10:02:00Z",
      published_at: null,
    },
  ];

  const supabase = createMockSupabase({
    rpcHandler: async (_fn, params) => {
      receivedScope = params.export_scope;
      if (params.export_scope === "all") {
        return {
          data: {
            activity: defaultActivity,
            ideas: mixedIdeas,
            total: 3,
          },
          error: null,
        };
      }
      return {
        data: {
          activity: defaultActivity,
          ideas: [mixedIdeas[0]],
          total: 1,
        },
        error: null,
      };
    },
  });

  // 1. Probar alcance predeterminado (published)
  const resPub = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );
  assert.equal(resPub.status, 200);
  assert.equal(receivedScope, "published");
  const csvPub = await resPub.text();
  assert.ok(!csvPub.includes('"Estado"'));

  // 2. Probar alcance explícito (all)
  const resAll = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=csv&scope=all",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );
  assert.equal(resAll.status, 200);
  assert.equal(receivedScope, "all");
  const csvAll = await resAll.text();
  assert.ok(csvAll.includes('"Estado"'));
  assert.ok(csvAll.includes('"Publicada"'));
  assert.ok(csvAll.includes('"Pendiente"'));
  assert.ok(csvAll.includes('"Oculta"'));
});

test("ESC-12: Cabeceras HTTP de seguridad, sanitización de nombre de archivo y exclusión total de PII", async () => {
  const supabase = createMockSupabase({
    currentUser: {
      id: "user-organizer-1",
      email: "organizador.secreto@dominio.gob.ar",
    },
    rpcHandler: async () => ({
      data: {
        activity: {
          ...defaultActivity,
          public_code: "MI-CODIGO-2026!",
        },
        ideas: [
          {
            id: "idea-1",
            content: "Propuesta sin rastros personales",
            status: "published",
            created_at: "2026-10-29T10:00:00Z",
            published_at: "2026-10-29T10:00:00Z",
          },
        ],
        total: 1,
      },
      error: null,
    }),
  });

  const res = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );

  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get("cache-control"),
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(
    res.headers
      .get("content-disposition")
      .includes('filename="muro-MI-CODIGO-2026-'),
    "El nombre de archivo debe sanitizarse eliminando caracteres especiales",
  );

  const csv = await res.text();
  assert.ok(!csv.toLowerCase().includes("organizador.secreto"));
  assert.ok(!csv.toLowerCase().includes("email"));
  assert.ok(!csv.toLowerCase().includes("autor"));
  assert.ok(!csv.toLowerCase().includes("participante"));
});

test("ESC-PARAM: Parámetros inválidos (format=xlsx, format=pdf) retornan HTTP 400", async () => {
  const supabase = createMockSupabase();

  const resXlsx = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=xlsx",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );
  assert.equal(resXlsx.status, 400);

  const resPdf = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=pdf",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );
  assert.equal(resPdf.status, 400);
  assert.equal(supabase.rpcCalls.length, 0);
  assert.equal(supabase.fromCalls.length, 0);
});
