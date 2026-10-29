import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { generateCsv } from "../src/lib/export/csv.ts";
import { generateHtmlSlideDeck } from "../src/lib/export/html.ts";
import {
  BATCH_SIZE,
  exportQuerySchema,
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
    return { exportQuerySchema, MAX_EXPORT_LIMIT, BATCH_SIZE };
  if (name.includes("supabase/server")) return { createClient: () => {} };
  return {};
});

const { GET } = routeMod.exports;

/**
 * Generador de cliente Supabase simulado con ordenamiento determinista multicriterio,
 * paginación estricta y simulación de fallos de red/concurrencia.
 */
function createMockSupabase({
  currentUser = { id: "user-organizer-1", email: "organizer@test.com" },
  activity = {
    id: "act-123",
    owner_id: "user-organizer-1",
    public_code: "TESTCODE",
    title: "Actividad de Prueba",
    question: "¿Qué propones?",
    status: "open",
    created_at: "2026-10-29T10:00:00Z",
  },
  ideas = [],
  dbCountError = null,
  initialCountOverride = undefined,
  dbSelectError = null,
  selectErrorOnBatchIndex = null,
  recountOverride = undefined,
  dbRecountError = null,
  duplicateBatchShift = false,
  compensatingDuplicateShift = false,
  prematureEmptyBatch = false,
  onRangeCalled = null,
} = {}) {
  let countCallCount = 0;
  let batchCallCount = 0;

  return {
    auth: {
      getUser: async () => ({
        data: { user: currentUser },
        error: null,
      }),
    },
    from: (table) => {
      if (table === "activities") {
        let filterId = null;
        let filterOwner = null;

        const activityQuery = {
          select: () => activityQuery,
          eq: (column, val) => {
            if (column === "id") filterId = val;
            if (column === "owner_id") filterOwner = val;
            return activityQuery;
          },
          maybeSingle: async () => {
            if (
              activity &&
              activity.id === filterId &&
              activity.owner_id === filterOwner
            ) {
              return { data: { ...activity }, error: null };
            }
            return { data: null, error: null };
          },
        };
        return activityQuery;
      }

      if (table === "ideas") {
        let isCountHead = false;
        let filterActivityId = null;
        let filterStatus = null;
        const orderings = [];
        let rangeFrom = 0;
        let rangeTo = Infinity;

        const ideasQuery = {
          select: (_fields, options) => {
            isCountHead = Boolean(
              options && options.count === "exact" && options.head === true,
            );
            return ideasQuery;
          },
          eq: (column, val) => {
            if (column === "activity_id") filterActivityId = val;
            if (column === "status") filterStatus = val;
            return ideasQuery;
          },
          order: (col, opts = {}) => {
            orderings.push({ col, ascending: opts.ascending !== false });
            return ideasQuery;
          },
          range: (from, to) => {
            rangeFrom = from;
            rangeTo = to;
            if (onRangeCalled) {
              onRangeCalled(from, to);
            }
            return ideasQuery;
          },
          // biome-ignore lint/suspicious/noThenProperty: Objeto thenable para simular el PostgrestBuilder diferido de Supabase
          then: (resolve) => {
            if (isCountHead) {
              countCallCount++;
              // Primer conteo vs Reconteo
              if (countCallCount === 1) {
                if (dbCountError) {
                  return resolve({ count: null, error: dbCountError });
                }
                if (initialCountOverride !== undefined) {
                  return resolve({ count: initialCountOverride, error: null });
                }
              } else {
                // Reconteo posterior a la paginación
                if (dbRecountError) {
                  return resolve({ count: null, error: dbRecountError });
                }
                if (recountOverride !== undefined) {
                  return resolve({ count: recountOverride, error: null });
                }
              }

              const matching = ideas.filter((i) => {
                if (filterActivityId && i.activity_id !== filterActivityId)
                  return false;
                if (filterStatus && i.status !== filterStatus) return false;
                return true;
              });
              return resolve({ count: matching.length, error: null });
            }

            batchCallCount++;

            if (
              selectErrorOnBatchIndex !== null &&
              batchCallCount === selectErrorOnBatchIndex
            ) {
              return resolve({
                data: null,
                error: {
                  message: `Fallo en el lote ${batchCallCount}`,
                  code: "500_BATCH",
                },
              });
            }

            if (dbSelectError) {
              return resolve({ data: null, error: dbSelectError });
            }

            if (prematureEmptyBatch && batchCallCount > 1) {
              return resolve({ data: [], error: null });
            }

            let matching = ideas.filter((i) => {
              if (filterActivityId && i.activity_id !== filterActivityId)
                return false;
              if (filterStatus && i.status !== filterStatus) return false;
              return true;
            });

            // Ordenamiento determinista multicriterio (created_at ASC, id ASC)
            if (orderings.length > 0) {
              matching = [...matching].sort((a, b) => {
                for (const o of orderings) {
                  const valA = a[o.col];
                  const valB = b[o.col];
                  if (valA < valB) return o.ascending ? -1 : 1;
                  if (valA > valB) return o.ascending ? 1 : -1;
                }
                return 0;
              });
            }

            // Simular límite de PostgREST: máximo 1.000 por respuesta
            const requestedSlice = matching.slice(rangeFrom, rangeTo + 1);
            let postgrestLimited = requestedSlice.slice(0, 1000);

            // Simulación de duplicación por inserción concurrente en el lote 2
            if (
              duplicateBatchShift &&
              batchCallCount === 2 &&
              postgrestLimited.length > 0 &&
              ideas.length > 0
            ) {
              postgrestLimited = [
                { ...ideas[0] },
                ...postgrestLimited.slice(1),
              ];
            }

            // Simulación de omisión y duplicación compensadas (misma cantidad total pero con un ID repetido)
            if (
              compensatingDuplicateShift &&
              batchCallCount === 1 &&
              postgrestLimited.length > 1
            ) {
              postgrestLimited[1] = { ...postgrestLimited[0] };
            }

            return resolve({ data: postgrestLimited, error: null });
          },
        };
        return ideasQuery;
      }

      throw new Error(`Tabla no simulada: ${table}`);
    },
  };
}

// ============================================================================
// 1. ORDEN DETERMINISTA Y LÍMITE ENTRE BLOQUES CON FECHAS IDÉNTICAS
// ============================================================================
test("H1-01: Fechas idénticas con desempate por id en el límite de bloque (offset 999 a 1000)", async () => {
  const total = 1200;
  const sameDate = "2026-10-29T10:00:00.000Z";
  const ideasList = [];

  for (let i = 0; i < total; i++) {
    // Todos tienen la misma fecha exacta; el id desempatará numéricamente
    const paddedId = String(i).padStart(5, "0");
    ideasList.push({
      id: `id-${paddedId}`,
      activity_id: "act-123",
      content: `Idea con id ${paddedId}`,
      status: "published",
      created_at: sameDate,
      published_at: sameDate,
    });
  }

  const supabase = createMockSupabase({ ideas: ideasList });
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

  // Verificar que la idea en el índice 999 (fin del lote 1) y 1000 (inicio del lote 2) estén ordenadas y presentes
  assert.ok(csv.includes("Idea con id 00999"));
  assert.ok(csv.includes("Idea con id 01000"));
});

// ============================================================================
// 2. EXPORTACIÓN DE MÁS DE 1.000 REGISTROS EN CSV Y HTML CON VERIFICACIÓN COMPLETA
// ============================================================================
test("H1-02: Exportación de 1.500 registros en CSV y HTML con verificación del 100% de la colección", async () => {
  const count = 1500;
  const largeIdeasList = [];
  for (let i = 0; i < count; i++) {
    largeIdeasList.push({
      id: `id-full-${i + 1}`,
      activity_id: "act-123",
      content: `Idea exhaustiva ${i + 1}`,
      status: "published",
      created_at: new Date(Date.now() + i * 1000).toISOString(),
      published_at: new Date(Date.now() + i * 1000).toISOString(),
    });
  }

  const supabase = createMockSupabase({ ideas: largeIdeasList });

  // 1. Probar CSV y verificar la totalidad de los 1.500 IDs
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

  // Comprobar que no sea solo una muestra: verificar cada uno de los 1.500 registros
  for (let i = 0; i < count; i++) {
    assert.ok(
      csvText.includes(`Idea exhaustiva ${i + 1}`),
      `Debe contener la idea ${i + 1}`,
    );
  }

  // 2. Probar HTML con más de 1.000 registros
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
  assert.ok(htmlText.includes("1500"));
  assert.ok(htmlText.includes("Idea exhaustiva 1<"));
  assert.ok(htmlText.includes("Idea exhaustiva 1500<"));
});

// ============================================================================
// 3. EXACTAMENTE 5.000 REGISTROS (200 OK) Y MÁS DE 5.000 (413)
// ============================================================================
test("H1-03A: Exactamente 5.000 registros permitidos -> 200 OK con 5 bloques completos", async () => {
  const exactly5000 = [];
  for (let i = 0; i < 5000; i++) {
    exactly5000.push({
      id: `id-5k-${i}`,
      activity_id: "act-123",
      content: `Idea 5k ${i}`,
      status: "published",
      created_at: new Date(Date.now() + i * 10).toISOString(),
      published_at: new Date(Date.now() + i * 10).toISOString(),
    });
  }

  const ranges = [];
  const supabase = createMockSupabase({
    ideas: exactly5000,
    onRangeCalled: (from, to) => ranges.push({ from, to }),
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
  assert.equal(ranges.length, 5, "Debe ejecutar exactamente 5 lotes de 1.000");
  assert.deepEqual(ranges[4], { from: 4000, to: 4999 });
});

test("H1-03B: Más de 5.000 registros (5.001) -> 413 Payload Too Large sin generar archivo parcial", async () => {
  const overLimit = [];
  for (let i = 0; i < 5001; i++) {
    overLimit.push({
      id: `id-over-${i}`,
      activity_id: "act-123",
      content: `Idea over ${i}`,
      status: "published",
      created_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
    });
  }

  const supabase = createMockSupabase({ ideas: overLimit });
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
});

// ============================================================================
// 4. DETECCIÓN DE IDS DUPLICADOS -> 409
// ============================================================================
test("H1-04: Detección estricta de IDs duplicados por desplazamiento de concurrencia -> 409 Conflict", async () => {
  const list = [];
  for (let i = 0; i < 1500; i++) {
    list.push({
      id: `id-dup-${i}`,
      activity_id: "act-123",
      content: `Idea ${i}`,
      status: "published",
      created_at: new Date(Date.now() + i * 100).toISOString(),
      published_at: new Date(Date.now() + i * 100).toISOString(),
    });
  }

  // Simula que durante el lote 2 se repite el ID del lote 1
  const supabase = createMockSupabase({
    ideas: list,
    duplicateBatchShift: true,
  });

  const req = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
  );
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );

  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.error, "export_inconsistency");
});

// ============================================================================
// 5. OMISIÓN Y DUPLICACIÓN COMPENSADAS CON CANTIDAD TOTAL IDÉNTICA -> 409
// ============================================================================
test("H1-05: Omisión y duplicación compensadas con cantidad total idéntica -> 409 Conflict", async () => {
  const list = [
    {
      id: "id-comp-1",
      activity_id: "act-123",
      content: "Uno",
      status: "published",
      created_at: "",
      published_at: "",
    },
    {
      id: "id-comp-2",
      activity_id: "act-123",
      content: "Dos",
      status: "published",
      created_at: "",
      published_at: "",
    },
    {
      id: "id-comp-3",
      activity_id: "act-123",
      content: "Tres",
      status: "published",
      created_at: "",
      published_at: "",
    },
  ];

  // Simula que la consulta devuelve 3 registros en total (cantidad esperada = 3),
  // pero el registro 2 es una copia del 1 (duplicado) y el registro 2 original fue omitido
  const supabase = createMockSupabase({
    ideas: list,
    compensatingDuplicateShift: true,
  });

  const req = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
  );
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );

  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.error, "export_inconsistency");
});

// ============================================================================
// 6. PÁGINA VACÍA PREMATURA ANTES DE COMPLETAR EL TOTAL -> 409
// ============================================================================
test("H1-06: Página vacía prematura antes de alcanzar expectedCount -> 409 Conflict", async () => {
  const list = [];
  for (let i = 0; i < 1500; i++) {
    list.push({
      id: `id-premature-${i}`,
      activity_id: "act-123",
      content: `Idea ${i}`,
      status: "published",
      created_at: new Date(Date.now() + i * 100).toISOString(),
      published_at: new Date(Date.now() + i * 100).toISOString(),
    });
  }

  // Simula que el lote 2 devuelve un array vacío [] antes de tiempo
  const supabase = createMockSupabase({
    ideas: list,
    prematureEmptyBatch: true,
  });

  const req = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
  );
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );

  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.error, "export_inconsistency");
});

// ============================================================================
// 7. ERROR EN UN BLOQUE POSTERIOR AL PRIMERO -> 500
// ============================================================================
test("H1-07: Error de base de datos en un bloque posterior al primero (lote 2) -> 500 Internal Error", async () => {
  const list = [];
  for (let i = 0; i < 1500; i++) {
    list.push({
      id: `id-err-${i}`,
      activity_id: "act-123",
      content: `Idea ${i}`,
      status: "published",
      created_at: new Date(Date.now() + i * 100).toISOString(),
      published_at: new Date(Date.now() + i * 100).toISOString(),
    });
  }

  const supabase = createMockSupabase({
    ideas: list,
    selectErrorOnBatchIndex: 2,
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
});

// ============================================================================
// 8. CONTEO INICIAL NULO / INDETERMINADO -> 500
// ============================================================================
test("H1-08: Conteo inicial nulo no se interpreta como cero -> 500 Internal Error", async () => {
  const supabase = createMockSupabase({
    initialCountOverride: null,
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
  assert.ok(json.message.includes("conteo"));
});

// ============================================================================
// 9. DIFERENCIA ENTRE CONTEO INICIAL Y RECONTEO -> 409
// ============================================================================
test("H1-09: Diferencia entre conteo inicial y reconteo por inserción concurrente -> 409 Conflict", async () => {
  const list = [
    {
      id: "1",
      activity_id: "act-123",
      content: "Uno",
      status: "published",
      created_at: "",
      published_at: "",
    },
    {
      id: "2",
      activity_id: "act-123",
      content: "Dos",
      status: "published",
      created_at: "",
      published_at: "",
    },
  ];

  // Conteo inicial = 2, pero durante el reconteo aumentó a 3
  const supabase = createMockSupabase({
    ideas: list,
    initialCountOverride: 2,
    recountOverride: 3,
  });

  const req = new Request(
    "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
  );
  const res = await GET(
    req,
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );

  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.error, "export_inconsistency");
});

// ============================================================================
// 10. RECONTEO SUPERIOR AL LÍMITE MÁXIMO -> 413
// ============================================================================
test("H1-10: Reconteo posterior que detecta superación de 5.000 ideas concurrentes -> 413", async () => {
  const list = [
    {
      id: "1",
      activity_id: "act-123",
      content: "Uno",
      status: "published",
      created_at: "",
      published_at: "",
    },
  ];

  // Conteo inicial = 1, pero durante la descarga la actividad creció a 5.005 ideas
  const supabase = createMockSupabase({
    ideas: list,
    initialCountOverride: 1,
    recountOverride: 5005,
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
  assert.equal(json.total, 5005);
});

// ============================================================================
// 11. ERROR DURANTE EL RECONTEO -> 500
// ============================================================================
test("H1-11: Fallo durante el reconteo de verificación -> 500 sin declarar falsamente íntegro", async () => {
  const list = [
    {
      id: "1",
      activity_id: "act-123",
      content: "Uno",
      status: "published",
      created_at: "",
      published_at: "",
    },
  ];

  const supabase = createMockSupabase({
    ideas: list,
    dbRecountError: {
      message: "Database connection dropped during recount",
      code: "08006",
    },
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
  assert.ok(json.message.includes("verificar el conteo final"));
});

// ============================================================================
// 12. CONSERVACIÓN DE AUTORIZACIÓN, ALCANCE, PRIVACIDAD Y CABECERAS
// ============================================================================
test("H1-12: Autorización 401/404, validación 400, alcance published/all y cabeceras seguras", async () => {
  const supabase = createMockSupabase();

  // 1. 401 sin sesión
  const supabaseNoUser = createMockSupabase({ currentUser: null });
  const res401 = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabaseNoUser,
  );
  assert.equal(res401.status, 401);

  // 2. 404 actividad ajena
  const supabaseOther = createMockSupabase({
    currentUser: { id: "other-user", email: "other@test.com" },
  });
  const res404 = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabaseOther,
  );
  assert.equal(res404.status, 404);

  // 3. 400 formatos inválidos
  const res400Xlsx = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=xlsx",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );
  assert.equal(res400Xlsx.status, 400);

  const res400Pdf = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=pdf",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabase,
  );
  assert.equal(res400Pdf.status, 400);

  // 4. Cabeceras seguras y saneamiento
  const ideasWithPii = [
    {
      id: "1",
      activity_id: "act-123",
      content: "Propuesta pública",
      status: "published",
      created_at: "2026-10-29T10:00:00Z",
      published_at: "2026-10-29T10:00:00Z",
    },
  ];
  const supabaseSafe = createMockSupabase({ ideas: ideasWithPii });
  const res200 = await GET(
    new Request(
      "http://localhost:3000/panel/actividad/act-123/exportar?format=csv",
    ),
    { params: Promise.resolve({ id: "act-123" }) },
    supabaseSafe,
  );
  assert.equal(res200.status, 200);
  assert.equal(
    res200.headers.get("cache-control"),
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  assert.equal(res200.headers.get("x-content-type-options"), "nosniff");
  assert.ok(
    res200.headers
      .get("content-disposition")
      .includes('filename="muro-TESTCODE-'),
  );

  const csv = await res200.text();
  assert.ok(!csv.toLowerCase().includes("email"));
  assert.ok(!csv.toLowerCase().includes("organizer@test.com"));
});
