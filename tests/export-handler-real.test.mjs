import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { generateCsv } from '../src/lib/export/csv.ts';
import { generateHtmlSlideDeck } from '../src/lib/export/html.ts';
import {
  BATCH_SIZE,
  MAX_EXPORT_LIMIT,
  exportQuerySchema,
} from '../src/lib/export/schemas.ts';

// Cargar y transpilar el handler real de route.ts
const routePath = path.join(process.cwd(), 'src', 'app', 'panel', 'actividad', '[id]', 'exportar', 'route.ts');
const routeSource = fs.readFileSync(routePath, 'utf8');

const jsCode = ts.transpileModule(routeSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;

const fnCode = jsCode;
const routeMod = { exports: {} };
const runner = new Function('module', 'exports', 'require', fnCode);

// Simular NextResponse compatible con Web Response estándar
class MockNextResponse extends Response {
  static json(data, init = {}) {
    const body = JSON.stringify(data);
    const headers = new Headers(init.headers || {});
    headers.set('content-type', 'application/json');
    return new MockNextResponse(body, { ...init, headers });
  }
}

runner(routeMod, routeMod.exports, (name) => {
  if (name.includes('next/server')) return { NextResponse: MockNextResponse };
  if (name.includes('export/csv')) return { generateCsv };
  if (name.includes('export/html')) return { generateHtmlSlideDeck };
  if (name.includes('export/schemas')) return { exportQuerySchema, MAX_EXPORT_LIMIT, BATCH_SIZE };
  if (name.includes('supabase/server')) return { createClient: () => {} };
  return {};
});

const { GET } = routeMod.exports;

/**
 * Generador de cliente Supabase simulado con soporte de paginación y control fino de errores
 */
function createMockSupabase({
  currentUser = { id: 'user-organizer-1', email: 'organizer@test.com' },
  activity = {
    id: 'act-123',
    owner_id: 'user-organizer-1',
    public_code: 'TESTCODE',
    title: 'Actividad de Prueba',
    question: '¿Qué propones?',
    status: 'open',
    created_at: '2026-10-29T10:00:00Z'
  },
  ideas = [],
  dbCountError = null,
  dbSelectError = null,
  discrepantCount = null,
  onRangeCalled = null,
} = {}) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: currentUser },
        error: null
      })
    },
    from: (table) => {
      if (table === 'activities') {
        let filterId = null;
        let filterOwner = null;

        const activityQuery = {
          select: () => activityQuery,
          eq: (column, val) => {
            if (column === 'id') filterId = val;
            if (column === 'owner_id') filterOwner = val;
            return activityQuery;
          },
          maybeSingle: async () => {
            if (activity && activity.id === filterId && activity.owner_id === filterOwner) {
              return { data: { ...activity }, error: null };
            }
            return { data: null, error: null };
          }
        };
        return activityQuery;
      }

      if (table === 'ideas') {
        let isCountHead = false;
        let filterActivityId = null;
        let filterStatus = null;
        let rangeFrom = 0;
        let rangeTo = Infinity;

        const ideasQuery = {
          select: (fields, options) => {
            isCountHead = Boolean(options && options.count === 'exact' && options.head === true);
            return ideasQuery;
          },
          eq: (column, val) => {
            if (column === 'activity_id') filterActivityId = val;
            if (column === 'status') filterStatus = val;
            return ideasQuery;
          },
          order: () => ideasQuery,
          range: (from, to) => {
            rangeFrom = from;
            rangeTo = to;
            if (onRangeCalled) {
              onRangeCalled(from, to);
            }
            return ideasQuery;
          },
          then: (resolve) => {
            if (isCountHead) {
              if (dbCountError) {
                return resolve({ count: null, error: dbCountError });
              }
              if (discrepantCount !== null) {
                return resolve({ count: discrepantCount, error: null });
              }
              const matching = ideas.filter(i => {
                if (filterActivityId && i.activity_id !== filterActivityId) return false;
                if (filterStatus && i.status !== filterStatus) return false;
                return true;
              });
              return resolve({ count: matching.length, error: null });
            }

            if (dbSelectError) {
              return resolve({ data: null, error: dbSelectError });
            }

            const matching = ideas.filter(i => {
              if (filterActivityId && i.activity_id !== filterActivityId) return false;
              if (filterStatus && i.status !== filterStatus) return false;
              return true;
            });

            // Simular límite de PostgREST: no más de 1000 registros por query
            const requestedSlice = matching.slice(rangeFrom, rangeTo + 1);
            const postgrestLimited = requestedSlice.slice(0, 1000);
            return resolve({ data: postgrestLimited, error: null });
          }
        };
        return ideasQuery;
      }

      throw new Error(`Tabla no simulada: ${table}`);
    }
  };
}

// ----------------------------------------------------------------------------
// TEST 1: 200 OK con pocos registros (CSV y HTML)
// ----------------------------------------------------------------------------
test('HANDLER-01: 200 OK - exportación completa con pocos registros (CSV y HTML)', async () => {
  const sampleIdeas = [
    { id: '1', activity_id: 'act-123', content: 'Primera idea', status: 'published', created_at: '2026-10-29T10:00:00Z', published_at: '2026-10-29T10:05:00Z' },
    { id: '2', activity_id: 'act-123', content: 'Segunda idea', status: 'published', created_at: '2026-10-29T10:01:00Z', published_at: '2026-10-29T10:06:00Z' },
  ];
  const supabase = createMockSupabase({ ideas: sampleIdeas });

  // 1. Probar CSV
  const reqCsv = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=csv');
  const resCsv = await GET(reqCsv, { params: Promise.resolve({ id: 'act-123' }) }, supabase);

  assert.equal(resCsv.status, 200);
  assert.equal(resCsv.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(resCsv.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, proxy-revalidate');
  assert.equal(resCsv.headers.get('x-content-type-options'), 'nosniff');

  // Comprobar bytes crudos para verificar el BOM UTF-8 (EF BB BF)
  const csvBytes = await resCsv.bytes();
  assert.equal(csvBytes[0], 0xEF, 'Byte 0 debe ser 0xEF');
  assert.equal(csvBytes[1], 0xBB, 'Byte 1 debe ser 0xBB');
  assert.equal(csvBytes[2], 0xBF, 'Byte 2 debe ser 0xBF');

  const csvBody = new TextDecoder().decode(csvBytes);
  assert.ok(csvBody.includes('Primera idea'));
  assert.ok(csvBody.includes('Segunda idea'));

  // 2. Probar HTML
  const reqHtml = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=html');
  const resHtml = await GET(reqHtml, { params: Promise.resolve({ id: 'act-123' }) }, supabase);

  assert.equal(resHtml.status, 200);
  assert.equal(resHtml.headers.get('content-type'), 'text/html; charset=utf-8');
  const htmlBody = await resHtml.text();
  assert.ok(htmlBody.includes('Actividad de Prueba'));
  assert.ok(htmlBody.includes('Primera idea'));
  assert.ok(htmlBody.includes('Segunda idea'));
});

// ----------------------------------------------------------------------------
// TEST 2: 200 OK con paginación en bloques (más de 1.000 y hasta 5.000 ideas)
// ----------------------------------------------------------------------------
test('HANDLER-02: 200 OK - paginación en bloques con 2.500 ideas sin truncamiento silencioso', async () => {
  const count = 2500;
  const largeIdeasList = [];
  for (let i = 0; i < count; i++) {
    largeIdeasList.push({
      id: `idea-${i + 1}`,
      activity_id: 'act-123',
      content: `Propuesta correlativa número ${i + 1}`,
      status: 'published',
      created_at: new Date(Date.now() + i * 1000).toISOString(),
      published_at: new Date(Date.now() + i * 1000).toISOString(),
    });
  }

  const rangesRequested = [];
  const supabase = createMockSupabase({
    ideas: largeIdeasList,
    onRangeCalled: (from, to) => {
      rangesRequested.push({ from, to });
    }
  });

  const req = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=csv');
  const res = await GET(req, { params: Promise.resolve({ id: 'act-123' }) }, supabase);

  assert.equal(res.status, 200);

  // Comprobar que se hayan realizado 3 llamadas paginadas:
  // Lote 1: 0 a 999
  // Lote 2: 1000 a 1999
  // Lote 3: 2000 a 2499
  assert.equal(rangesRequested.length, 3, 'Debe paginar en 3 bloques de máximo 1.000 registros');
  assert.deepEqual(rangesRequested[0], { from: 0, to: 999 });
  assert.deepEqual(rangesRequested[1], { from: 1000, to: 1999 });
  assert.deepEqual(rangesRequested[2], { from: 2000, to: 2499 });

  const body = await res.text();
  // Verificar que la primera y la última idea estén presentes
  assert.ok(body.includes('Propuesta correlativa número 1'));
  assert.ok(body.includes('Propuesta correlativa número 1000'));
  assert.ok(body.includes('Propuesta correlativa número 1001'));
  assert.ok(body.includes('Propuesta correlativa número 2500'));
});

// ----------------------------------------------------------------------------
// TEST 3: 413 Payload Too Large si se exceden 5.000 ideas
// ----------------------------------------------------------------------------
test('HANDLER-03: 413 Payload Too Large - rechazo controlado ante más de 5.000 ideas', async () => {
  const overLimitIdeas = [];
  for (let i = 0; i < 5001; i++) {
    overLimitIdeas.push({
      id: `id-${i}`,
      activity_id: 'act-123',
      content: `Idea ${i}`,
      status: 'published',
      created_at: new Date().toISOString(),
      published_at: new Date().toISOString()
    });
  }

  const supabase = createMockSupabase({ ideas: overLimitIdeas });
  const req = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=csv');
  const res = await GET(req, { params: Promise.resolve({ id: 'act-123' }) }, supabase);

  assert.equal(res.status, 413);
  const json = await res.json();
  assert.equal(json.error, 'payload_too_large');
  assert.ok(json.message.includes('5.000 ideas'));
  assert.equal(json.total, 5001);
});

// ----------------------------------------------------------------------------
// TEST 4: 400 Bad Request ante parámetros inválidos
// ----------------------------------------------------------------------------
test('HANDLER-04: 400 Bad Request - parámetros de formato o alcance inválidos', async () => {
  const supabase = createMockSupabase();

  // Formato no soportado (xlsx)
  const reqXlsx = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=xlsx');
  const resXlsx = await GET(reqXlsx, { params: Promise.resolve({ id: 'act-123' }) }, supabase);
  assert.equal(resXlsx.status, 400);

  // Formato no soportado (pdf)
  const reqPdf = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=pdf');
  const resPdf = await GET(reqPdf, { params: Promise.resolve({ id: 'act-123' }) }, supabase);
  assert.equal(resPdf.status, 400);

  // Formato faltante
  const reqNone = new Request('http://localhost:3000/panel/actividad/act-123/exportar');
  const resNone = await GET(reqNone, { params: Promise.resolve({ id: 'act-123' }) }, supabase);
  assert.equal(resNone.status, 400);

  // Alcance no válido
  const reqScope = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=csv&scope=inventado');
  const resScope = await GET(reqScope, { params: Promise.resolve({ id: 'act-123' }) }, supabase);
  assert.equal(resScope.status, 400);
});

// ----------------------------------------------------------------------------
// TEST 5: 401 Unauthorized cuando no hay sesión autenticada
// ----------------------------------------------------------------------------
test('HANDLER-05: 401 Unauthorized - usuario anónimo sin sesión', async () => {
  const supabase = createMockSupabase({ currentUser: null });
  const req = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=csv');
  const res = await GET(req, { params: Promise.resolve({ id: 'act-123' }) }, supabase);

  assert.equal(res.status, 401);
});

// ----------------------------------------------------------------------------
// TEST 6: 404 Not Found cuando la actividad no existe o pertenece a otro usuario
// ----------------------------------------------------------------------------
test('HANDLER-06: 404 Not Found - actividad ajena o inexistente (sin confirmar existencia)', async () => {
  // Usuario diferente al owner_id ('other-user' vs 'user-organizer-1')
  const supabaseForeign = createMockSupabase({
    currentUser: { id: 'other-user', email: 'intruder@test.com' }
  });

  const reqForeign = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=csv');
  const resForeign = await GET(reqForeign, { params: Promise.resolve({ id: 'act-123' }) }, supabaseForeign);
  assert.equal(resForeign.status, 404);

  // Actividad inexistente
  const supabaseNullAct = createMockSupabase({ activity: null });
  const reqNull = new Request('http://localhost:3000/panel/actividad/no-existe/exportar?format=csv');
  const resNull = await GET(reqNull, { params: Promise.resolve({ id: 'no-existe' }) }, supabaseNullAct);
  assert.equal(resNull.status, 404);
});

// ----------------------------------------------------------------------------
// TEST 7: Filtrado correcto por published y all
// ----------------------------------------------------------------------------
test('HANDLER-07: Filtrado correcto según scope (published vs all)', async () => {
  const mixedIdeas = [
    { id: '1', activity_id: 'act-123', content: 'Idea publicada', status: 'published', created_at: '2026-10-29T10:00:00Z', published_at: '2026-10-29T10:00:00Z' },
    { id: '2', activity_id: 'act-123', content: 'Idea pendiente', status: 'pending', created_at: '2026-10-29T10:01:00Z', published_at: null },
    { id: '3', activity_id: 'act-123', content: 'Idea oculta', status: 'hidden', created_at: '2026-10-29T10:02:00Z', published_at: null },
  ];
  const supabase = createMockSupabase({ ideas: mixedIdeas });

  // 1. scope=published por defecto
  const reqPub = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=csv');
  const resPub = await GET(reqPub, { params: Promise.resolve({ id: 'act-123' }) }, supabase);
  assert.equal(resPub.status, 200);
  const textPub = await resPub.text();
  assert.ok(textPub.includes('Idea publicada'));
  assert.ok(!textPub.includes('Idea pendiente'), 'Pendientes excluidas por defecto');
  assert.ok(!textPub.includes('Idea oculta'), 'Ocultas excluidas por defecto');

  // 2. scope=all explícito
  const reqAll = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=csv&scope=all');
  const resAll = await GET(reqAll, { params: Promise.resolve({ id: 'act-123' }) }, supabase);
  assert.equal(resAll.status, 200);
  const textAll = await resAll.text();
  assert.ok(textAll.includes('Idea publicada'));
  assert.ok(textAll.includes('Idea pendiente'));
  assert.ok(textAll.includes('Idea oculta'));
});

// ----------------------------------------------------------------------------
// TEST 8: Discrepancia o carrera de concurrencia detectada -> 409 controlado
// ----------------------------------------------------------------------------
test('HANDLER-08: Discrepancia entre conteo y registros -> 409 controlado sin exportación corrupta', async () => {
  // Simular que el conteo inicial dijo 10 ideas, pero al recuperarlas solo vinieron 8
  const eightIdeas = [];
  for (let i = 0; i < 8; i++) {
    eightIdeas.push({
      id: `id-${i}`,
      activity_id: 'act-123',
      content: `Idea ${i}`,
      status: 'published',
      created_at: new Date().toISOString(),
      published_at: new Date().toISOString()
    });
  }

  // Supabase simulado donde el count inicial es 10 pero solo hay 8 ideas
  const supabase = createMockSupabase({
    ideas: eightIdeas,
    discrepantCount: 10
  });

  const req = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=csv');
  const res = await GET(req, { params: Promise.resolve({ id: 'act-123' }) }, supabase);

  assert.equal(res.status, 409, 'Debe devolver 409 ante discrepancia de integridad');
  const json = await res.json();
  assert.equal(json.error, 'export_inconsistency');
  assert.equal(json.expected, 10);
  assert.equal(json.retrieved, 8);
});

// ----------------------------------------------------------------------------
// TEST 9: Error de base de datos -> 500 controlado sin filtrar detalles
// ----------------------------------------------------------------------------
test('HANDLER-09: 500 Internal Error ante fallo controlado de base de datos', async () => {
  const supabaseErr = createMockSupabase({
    dbCountError: { message: 'Connection timeout', code: '57P01' }
  });

  const req = new Request('http://localhost:3000/panel/actividad/act-123/exportar?format=csv');
  const res = await GET(req, { params: Promise.resolve({ id: 'act-123' }) }, supabaseErr);

  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.error, 'database_error');
});

// ----------------------------------------------------------------------------
// TEST 10: Integridad de cabeceras, archivo seguro y ausencia de datos personales
// ----------------------------------------------------------------------------
test('HANDLER-10: Saneamiento de nombre de archivo, cabeceras seguras y cero PII', async () => {
  const customAct = {
    id: 'act-999',
    owner_id: 'user-organizer-1',
    public_code: 'SECURE_123',
    title: 'Actividad con Caracteres Especiales: ¿Cómo vamos?',
    question: 'Pregunta',
    status: 'open',
    created_at: '2026-10-29T10:00:00Z'
  };
  const ideas = [
    { id: '1', activity_id: 'act-999', content: 'Una sugerencia de diseño', status: 'published', created_at: '2026-10-29T10:00:00Z', published_at: '2026-10-29T10:00:00Z' }
  ];
  const supabase = createMockSupabase({ activity: customAct, ideas });

  const req = new Request('http://localhost:3000/panel/actividad/act-999/exportar?format=csv');
  const res = await GET(req, { params: Promise.resolve({ id: 'act-999' }) }, supabase);

  assert.equal(res.status, 200);
  const disposition = res.headers.get('content-disposition');
  assert.ok(disposition.includes('filename="muro-SECURE_123-'));
  assert.ok(disposition.endsWith('.csv"'));

  const body = await res.text();
  assert.ok(!body.toLowerCase().includes('email'));
  assert.ok(!body.toLowerCase().includes('organizer@test.com'));
  assert.ok(!body.toLowerCase().includes('nombre'));
  assert.ok(!body.toLowerCase().includes('apellido'));
});
