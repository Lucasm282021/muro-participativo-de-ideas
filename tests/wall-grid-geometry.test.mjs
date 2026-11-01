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

test('GEOM-04: Escenarios de alta densidad y preservación de legibilidad (tope 30 por viewport)', () => {
  const c24 = getGridConfig(24, 1600, 850);
  assert.equal(c24.cols, 6);
  assert.equal(c24.rows, 4, '24 ideas ocupan 6x4 celdas');

  const c30 = getGridConfig(30, 1600, 850);
  assert.equal(c30.cols, 6);
  assert.equal(c30.rows, 5, '30 ideas entran exactamente en 6x5 celdas sin scroll');

  const gap = 8;
  const width30 = (1600 - gap * (c30.cols - 1)) / c30.cols;
  const height30 = (850 - gap * (c30.rows - 1)) / c30.rows;
  assert.ok(width30 >= 260, `Ancho con 30 ideas (${width30.toFixed(1)}px) >= 260px`);
  assert.ok(height30 >= 160, `Alto con 30 ideas (${height30.toFixed(1)}px) >= 160px`);

  // Escenario 48 ideas: conserva ancho y alto legibles sin achicar tarjetas a estampillas
  const c48 = getGridConfig(48, 1600, 850);
  assert.equal(c48.cols, 6, 'Mantiene 6 columnas legibles (nunca 8)');
  assert.equal(c48.rows, 8, '8 filas accesibles mediante scroll suave');

  const visibleRows = Math.min(c48.rows, 5);
  const height48 = (850 - gap * (visibleRows - 1)) / visibleRows;
  assert.ok(height48 >= 160, `Alto con 48 ideas (${height48.toFixed(1)}px) conserva >= 160px`);
});

test('GEOM-05: Entorno Mobile (400x700 px útiles)', () => {
  const cMobile = getGridConfig(1, 400, 700);
  assert.equal(cMobile.cols, 2, 'Mobile inicia con 2 columnas base');
  assert.ok(cMobile.rows >= 3, 'Mobile asigna filas proporcionadas');
});

test('TYPO-01: Tipografía y lectura completa de ideas largas en alta densidad', () => {
  // Idea extensa de 180 caracteres
  const longIdea = 'Propongo que armemos un taller semanal de diseño colaborativo donde cada equipo presente sus avances y podamos darnos feedback constructivo para mejorar la calidad del producto.';
  const typo = calculateCardTypography(longIdea, 260, 162);
  const size = parseFloat(typo.fontSize);
  assert.ok(size >= 12 && size <= 18, `Tipografía (${size}px) en rango legible para párrafos editoriales`);
  assert.ok(typo.lineClamp >= 5, `lineClamp (${typo.lineClamp}) permite leer hasta 6 o 7 líneas completas sin truncamiento`);
});
