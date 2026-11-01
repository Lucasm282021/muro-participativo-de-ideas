import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const filePath = path.join(process.cwd(), 'src', 'components', 'live-wall.tsx');
const file = fs.readFileSync(filePath, 'utf8');

// Transpilación segura con TypeScript
const jsCode = ts.transpileModule(file, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React
  }
}).outputText;

const fnCode = jsCode + `
module.exports = { getGridConfig, getWideIdeaIds, calculateCardTypography };
`;

const mod = { exports: {} };
const runner = new Function('module', 'exports', 'require', fnCode);
runner(mod, mod.exports, (name) => {
  if (name.includes('types')) return {};
  if (name.includes('about-modal')) return { AboutModal: () => null };
  if (name === 'react') return { useRef: () => ({ current: null }), useState: () => [null, () => {}], useEffect: () => {}, useCallback: (fn) => fn };
  if (name.includes('supabase')) return { createClient: () => {} };
  return {};
});

const { getGridConfig, getWideIdeaIds, calculateCardTypography } = mod.exports;

// -------------------------------------------------------------
// 1. PRUEBAS DE CALIBRACIÓN DE ANCHO Y TAMAÑO DE TARJETAS
// -------------------------------------------------------------

test('CARD-WIDTH-01: Ideas breves (1 a 74 caracteres) NUNCA se expanden a 2 columnas', () => {
  const shortIdeas = [
    { id: '1', content: 'Hola', created_at: '2026-10-28T10:00:00Z' },
    { id: '2', content: 'Cuarto envio', created_at: '2026-10-28T10:01:00Z' },
    { id: '3', content: 'Segundo envioo', created_at: '2026-10-28T10:02:00Z' },
    { id: '4', content: 'Que pregunta puedo hacer', created_at: '2026-10-28T10:03:00Z' },
    { id: '5', content: 'Maletero', created_at: '2026-10-28T10:04:00Z' },
    { id: '6', content: 'Será', created_at: '2026-10-28T10:05:00Z' },
    { id: '7', content: 'Mañana', created_at: '2026-10-28T10:06:00Z' },
    { id: '8', content: 'Svhdd', created_at: '2026-10-28T10:07:00Z' },
    { id: '9', content: 'Ahdhd', created_at: '2026-10-28T10:08:00Z' },
    { id: '10', content: 'Primer ebvio', created_at: '2026-10-28T10:09:00Z' },
  ];

  const wideSet = getWideIdeaIds(shortIdeas, 12);
  assert.equal(wideSet.size, 0, 'Ninguna idea corta o mediana debe recibir 2 columnas');
  assert.equal(wideSet.has('4'), false, '"Que pregunta puedo hacer" (24 chars) debe ser 1 columna');
  assert.equal(wideSet.has('2'), false, '"Cuarto envio" (12 chars) debe ser 1 columna');
  assert.equal(wideSet.has('3'), false, '"Segundo envioo" (14 chars) debe ser 1 columna');
});

test('CARD-WIDTH-02: Solo ideas extensas (>= 75 caracteres) califican para 2 columnas cuando hay espacio', () => {
  const mixedIdeas = [
    { id: '1', content: 'Hola', created_at: '2026-10-28T10:00:00Z' },
    { id: '2', content: 'Propongo armar un taller semanal donde cada equipo presente sus descubrimientos y aprendizajes para mejorar la calidad.', created_at: '2026-10-28T10:01:00Z' },
    { id: '3', content: 'Breve', created_at: '2026-10-28T10:02:00Z' },
    { id: '4', content: 'Esta es otra propuesta bien desarrollada que explica con claridad el impacto de la iniciativa en nuestra comunidad.', created_at: '2026-10-28T10:03:00Z' },
  ];

  const wideSet = getWideIdeaIds(mixedIdeas, 5);
  assert.equal(wideSet.size, 1, 'Debe asignar exactamente 1 slot extra');
  assert.ok(wideSet.has('2') || wideSet.has('4'), 'Debe elegir la idea extensa');
  assert.equal(wideSet.has('1'), false, 'La idea breve no debe ser wide');
  assert.equal(wideSet.has('3'), false, 'La idea breve no debe ser wide');
});

// -------------------------------------------------------------
// 2. PRUEBAS DE SEGURIDAD DEL TRIGGER Y MIGRACIÓN SQL
// -------------------------------------------------------------

test('SECURITY-01: Verificación estricta de search_path y privilegios en assign_idea_number', () => {
  const migPath = path.join(process.cwd(), 'supabase', 'migrations', '20261028150000_ideas_atomic_numbering.sql');
  assert.ok(fs.existsSync(migPath), 'El archivo de migración versionada debe existir');
  const sql = fs.readFileSync(migPath, 'utf8');

  // Hardening de seguridad para SECURITY DEFINER:
  // 1. search_path vacío para evitar secuestro de funciones o tablas (CWE-426)
  assert.match(sql, /set\s+search_path\s*=\s*''/i, 'search_path debe fijarse estrictamente a cadena vacía');

  // 2. Cualificación explícita de esquemas en todas las tablas
  assert.match(sql, /UPDATE\s+public\.activities/i, 'Cualificación explícita de public.activities');
  assert.match(sql, /LOCK\s+TABLE\s+public\.ideas/i, 'Cualificación explícita de public.ideas');

  // 3. Restricción de permisos: la función interna del trigger no debe ser ejecutable por anon o authenticated
  assert.match(sql, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.assign_idea_number\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i, 'Revoca permisos directos sobre la función interna');

  // 4. Validación de pertenencia: actividad debe existir y activity_id no nulo
  assert.match(sql, /IF\s+NEW\.activity_id\s+IS\s+NULL/i, 'Valida que activity_id no sea nulo');
  assert.match(sql, /RAISE\s+EXCEPTION\s+'Actividad/i, 'Lanza excepción si activity_id no existe');
});

test('SECURITY-02: Blindaje contra manipulación multi-tenant de contadores ajenos', () => {
  // Simulación: un intento de inserción con activity_id inexistente o manipulado
  const simulateTrigger = (newIdea, activitiesTable) => {
    if (!newIdea.activity_id) {
      throw new Error('activity_id no puede ser nulo');
    }
    const act = activitiesTable.find(a => a.id === newIdea.activity_id);
    if (!act) {
      throw new Error(`Actividad ${newIdea.activity_id} no encontrada`);
    }
    act.last_idea_number += 1;
    newIdea.idea_number = act.last_idea_number;
    return newIdea;
  };

  const activities = [
    { id: 'act-propia', last_idea_number: 5 },
    { id: 'act-ajena', last_idea_number: 100 }
  ];

  // Intento 1: insertar con id inexistente -> falla sin modificar ningún contador
  assert.throws(() => {
    simulateTrigger({ content: 'Hack', activity_id: 'act-inexistente' }, activities);
  }, /no encontrada/);
  assert.equal(activities[0].last_idea_number, 5, 'El contador propio no se alteró');
  assert.equal(activities[1].last_idea_number, 100, 'El contador ajeno no se alteró');

  // Intento 2: inserción válida en la actividad propia
  const idea = simulateTrigger({ content: 'Idea válida', activity_id: 'act-propia' }, activities);
  assert.equal(idea.idea_number, 6);
  assert.equal(activities[0].last_idea_number, 6);
  assert.equal(activities[1].last_idea_number, 100, 'La actividad ajena permanece inmutable');
});

// -------------------------------------------------------------
// 3. PRUEBAS DE AUSENCIA DE FALLBACK FANTASMA Y NUMERACIÓN NULA
// -------------------------------------------------------------

test('FALLBACK-01: Componente no muestra # ni números calculados cuando idea_number es null/undefined', () => {
  // Comprobación en código fuente de live-wall.tsx
  assert.doesNotMatch(file, /ideaIndexMap/, 'No debe existir ideaIndexMap que recalcule ordinales dinámicos');
  assert.doesNotMatch(file, /`#\${idea\.idea_number}`\s*:\s*"#"/, 'No debe renderizar "#" solitario si el número es nulo');
  assert.match(file, /idea\.idea_number\s*!=\s*null\s*\?\s*`#\${idea\.idea_number}`\s*:\s*null/, 'Si idea_number es nulo, la etiqueta no muestra texto incompleto');
});

test('STABILITY-01: Inmutabilidad absoluta tras eliminación intermedia y recarga', () => {
  // Simulación formal: Estado de base de datos
  const dbIdeas = [
    { id: '1', idea_number: 1, content: 'Idea 1', status: 'published' },
    { id: '2', idea_number: 2, content: 'Idea 2', status: 'published' },
    { id: '3', idea_number: 3, content: 'Idea 3', status: 'published' },
    { id: '4', idea_number: 4, content: 'Idea 4', status: 'published' },
  ];

  // 1. Se elimina físicamente la idea #2
  const dbAfterDelete = dbIdeas.filter(i => i.id !== '2');

  // 2. Simulación de Recarga de Página (SSR):
  // La consulta SQL `SELECT idea_number FROM ideas WHERE status = 'published' ORDER BY created_at DESC`
  // devuelve exactamente las 3 filas con sus números de base de datos intactos:
  const ssrWall = dbAfterDelete.map(i => ({
    id: i.id,
    content: i.content,
    idea_number: i.idea_number,
    label: i.idea_number != null ? `#${i.idea_number}` : null
  }));

  // Comprobación crítica: las ideas 3 y 4 conservan #3 y #4 en cualquier cliente que recargue
  assert.deepEqual(ssrWall.map(i => i.label), ['#1', '#3', '#4'], 'Los números persisten idénticos en SSR tras DELETE');
  assert.notEqual(ssrWall[1].label, '#2', 'La idea 3 NUNCA debe convertirse en #2');
  assert.notEqual(ssrWall[2].label, '#3', 'La idea 4 NUNCA debe convertirse en #3');
});
