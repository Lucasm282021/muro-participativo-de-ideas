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

test('GEOM-01: 1 idea en 1080p (1600x850 px útiles) conserva dimensiones armónicas naturales', () => {
  const config = getGridConfig(1, 1600, 850);
  assert.equal(config.cols, 5, 'Debe asignar 5 columnas naturales en 1600px');
  assert.equal(config.rows, 4, 'Debe asignar 4 filas naturales en 850px');

  const gap = 8;
  const cellWidth = (1600 - gap * (config.cols - 1)) / config.cols;
  const cellHeight = (850 - gap * (config.rows - 1)) / config.rows;

  assert.ok(cellWidth >= 260 && cellWidth <= 325, `cellWidth (${cellWidth.toFixed(1)}px) en rango 260-325px`);
  assert.ok(cellHeight >= 160 && cellHeight <= 220, `cellHeight (${cellHeight.toFixed(1)}px) en rango 160-220px`);
});

test('GEOM-02: Llenado progresivo de 1 a 16 ideas con geometría estable', () => {
  const c1 = getGridConfig(1, 1600, 850);
  const c2 = getGridConfig(2, 1600, 850);
  const c5 = getGridConfig(5, 1600, 850);
  const c16 = getGridConfig(16, 1600, 850);

  assert.equal(c1.cols, c2.cols, 'Cols idénticas entre 1 y 2');
  assert.equal(c1.rows, c2.rows, 'Rows idénticas entre 1 y 2');
  assert.equal(c1.cols, c5.cols, 'Cols idénticas con 5 ideas (fila 1 completa)');
  assert.equal(c1.cols, c16.cols, 'Cols idénticas con 16 ideas');
  assert.equal(c1.rows, c16.rows, 'Rows idénticas con 16 ideas');
});

test('GEOM-03: No estiramiento artificial con getWideIdeaIds en baja densidad', () => {
  const ideas = [{ id: 'idea-1', content: 'Prueba de publicación de ideas' }];
  const wideSet = getWideIdeaIds(ideas, 20);
  assert.equal(wideSet.has('idea-1'), false, '1 idea no debe marcarse como span 2');
});

test('GEOM-04: Escenarios de alta densidad (24, 30 y 48 ideas sin scroll)', () => {
  const c24 = getGridConfig(24, 1600, 850);
  assert.ok(c24.cols * c24.rows >= 24, 'Capacidad >= 24 celdas');

  const c30 = getGridConfig(30, 1600, 850);
  assert.ok(c30.cols * c30.rows >= 30, 'Capacidad >= 30 celdas');

  const c48 = getGridConfig(48, 1600, 850);
  assert.ok(c48.cols * c48.rows >= 48, 'Capacidad >= 48 celdas');
  assert.equal(c48.cols, 8);
  assert.equal(c48.rows, 6);
});

test('GEOM-05: Entorno Mobile (400x700 px útiles)', () => {
  const cMobile = getGridConfig(1, 400, 700);
  assert.equal(cMobile.cols, 2, 'Mobile inicia con 2 columnas base');
  assert.ok(cMobile.rows >= 3, 'Mobile asigna filas proporcionadas');
});

test('TYPO-01: Tipografía legible en baja densidad (sin gigantismo)', () => {
  const typo = calculateCardTypography('Prueba de idea corta', 313, 206);
  const size = parseFloat(typo.fontSize);
  assert.ok(size >= 16 && size <= 32, `Tipografía (${size}px) en rango editorial armónico`);
  assert.ok(typo.lineClamp >= 3, 'Permite al menos 3 líneas de lectura');
});
