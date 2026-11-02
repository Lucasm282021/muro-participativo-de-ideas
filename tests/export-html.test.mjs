import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, buildSlides, generateHtmlSlideDeck } from '../src/lib/export/html.ts';

test('HTML-01: Prevención estricta contra inyección XSS en contenidos de usuarios', () => {
  const malicious = '<script>alert("xss")</script><img src=x onerror=alert(1)> & " \' ';
  const escaped = escapeHtml(malicious);
  assert.ok(!escaped.includes('<script>'));
  assert.ok(!escaped.includes('<img'));
  assert.ok(escaped.includes('&lt;script&gt;'));
  assert.ok(escaped.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(escaped.includes('&amp;'));
  assert.ok(escaped.includes('&quot;'));
  assert.ok(escaped.includes('&#39;'));
});

test('HTML-02: Agrupamiento adaptativo de diapositivas según extensión del texto', () => {
  const ideas = [
    { id: '1', content: 'Corta 1', status: 'published', created_at: '', published_at: '' },
    { id: '2', content: 'Corta 2', status: 'published', created_at: '', published_at: '' },
    { id: '3', content: 'Corta 3', status: 'published', created_at: '', published_at: '' },
    {
      id: '4',
      content: 'Esta es una idea sumamente extensa que contiene más de ciento cuarenta caracteres con detalles explicativos sobre cómo optimizar el proceso de participación ciudadana en asambleas barriales.',
      status: 'published',
      created_at: '',
      published_at: ''
    },
    { id: '5', content: 'Corta 4', status: 'published', created_at: '', published_at: '' }
  ];

  const slides = buildSlides(ideas);
  // Portada: slide 0
  assert.equal(slides[0].type, 'cover');
  // Lote de 3 cortas: slide 1
  assert.equal(slides[1].type, 'ideas');
  assert.equal(slides[1].ideas.length, 3);
  // Idea larga: slide 2 (aislada)
  assert.equal(slides[2].type, 'ideas');
  assert.equal(slides[2].ideas.length, 1);
  assert.equal(slides[2].ideas[0].id, '4');
  // Corta restante: slide 3
  assert.equal(slides[3].type, 'ideas');
  assert.equal(slides[3].ideas.length, 1);
});

test('HTML-03: Manejo elegante de actividad sin ideas (diapositiva vacía explícita)', () => {
  const activity = {
    id: 'act-1',
    public_code: 'VACIA01',
    title: 'Actividad sin ideas',
    question: '¿Qué propones?',
    status: 'open',
    created_at: '2026-10-29T10:00:00Z'
  };
  const html = generateHtmlSlideDeck(activity, [], 'published');
  assert.ok(html.includes('Sin ideas registradas'));
  assert.ok(html.includes('No se encontraron ideas para esta actividad con el alcance seleccionado'));
});

test('HTML-04: Autocontención y funcionamiento 100% offline (sin peticiones externas)', () => {
  const activity = {
    id: 'act-1',
    public_code: 'TEST01',
    title: 'Actividad de prueba',
    question: '¿Pregunta?',
    status: 'open',
    created_at: '2026-10-29T10:00:00Z'
  };
  const html = generateHtmlSlideDeck(activity, [], 'published');
  assert.ok(!html.includes('http://'), 'No debe referenciar recursos HTTP externos');
  assert.ok(!html.includes('https://'), 'No debe referenciar recursos HTTPS externos');
  assert.ok(html.includes('<style>'), 'Los estilos CSS deben estar embebidos');
  assert.ok(html.includes('<script>'), 'El script de navegación debe estar embebido');
});

test('HTML-05: Soporte para accesibilidad y preferencias de movimiento reducido', () => {
  const activity = {
    id: 'act-1',
    public_code: 'ACC01',
    title: 'Prueba de accesibilidad',
    question: '¿Cómo mejorar la inclusión?',
    status: 'open',
    created_at: '2026-10-29T10:00:00Z'
  };
  const html = generateHtmlSlideDeck(activity, [], 'published');
  assert.ok(html.includes('prefers-reduced-motion'), 'Debe contemplar la directiva prefers-reduced-motion');
  assert.ok(html.includes('aria-roledescription="slide"'), 'Debe implementar semántica ARIA para diapositivas');
  assert.ok(html.includes('aria-live="polite"'), 'El contador de diapositivas debe ser accesible');
});

test('HTML-06: Identidad visual oficial clara de Muro común y marca embebida', () => {
  const activity = {
    id: 'act-brand',
    public_code: 'BRAND01',
    title: 'Identidad Visual',
    question: '¿Es coherente?',
    status: 'open',
    created_at: '2026-11-01T12:00:00Z'
  };
  const html = generateHtmlSlideDeck(activity, [], 'published');
  // Nombre y lema oficial
  assert.ok(html.includes('muro<strong>común</strong>') || html.includes('muro común') || html.includes('Muro común'));
  assert.ok(html.includes('Ideas que hacen lugar'), 'Debe incluir el lema oficial de la aplicación');
  // Logotipo oficial SVG embebido
  assert.ok(html.includes('<circle cx="32" cy="32" r="32" fill="#252c25"'), 'Debe embeber el isotipo oficial');
  assert.ok(html.includes('fill="#f8c864"'), 'Debe contener el punto característico de la marca');
  // Tokens de paleta clara
  assert.ok(html.includes('--paper: #f6f4ef'), 'Debe utilizar el fondo paper cálido institucional');
  assert.ok(html.includes('--ink: #202620'), 'Debe utilizar la tinta oscura institucional');
  assert.ok(html.includes('--green-deep: #315c3b'), 'Debe utilizar el verde institucional de acento');
});

test('HTML-07: Selector de 4 modalidades de visualización y paneles accesibles', () => {
  const activity = {
    id: 'act-modes',
    public_code: 'MODES01',
    title: 'Selector de Modalidades',
    question: '¿Están las 4 modalidades?',
    status: 'open',
    created_at: '2026-11-01T12:00:00Z'
  };
  const ideas = [
    { id: '1', content: 'Idea número uno', status: 'published', created_at: '2026-11-01T10:00:00Z', published_at: null },
    { id: '2', content: 'Idea número dos', status: 'published', created_at: '2026-11-01T10:30:00Z', published_at: null }
  ];
  const html = generateHtmlSlideDeck(activity, ideas, 'published');

  // Selector role="tablist" y botones de las 4 modalidades
  assert.ok(html.includes('role="tablist"'), 'Debe incluir la barra de pestañas');
  assert.ok(html.includes('id="tab-deck"'), 'Debe incluir tab de Presentación');
  assert.ok(html.includes('id="tab-mosaic"'), 'Debe incluir tab de Mosaico');
  assert.ok(html.includes('id="tab-list"'), 'Debe incluir tab de Listado');
  assert.ok(html.includes('id="tab-analytics"'), 'Debe incluir tab de Análisis');

  // Contenedores de las 4 modalidades
  assert.ok(html.includes('id="view-presentation"'), 'Debe contener el panel de Presentación');
  assert.ok(html.includes('id="view-mosaic"'), 'Debe contener el panel de Mosaico');
  assert.ok(html.includes('id="view-list"'), 'Debe contener el panel de Listado');
  assert.ok(html.includes('id="view-analytics"'), 'Debe contener el panel de Análisis');

  // Funcionalidad de cambio en JavaScript embebido
  assert.ok(html.includes('switchMode'), 'El script debe contener la lógica de alternancia');
  assert.ok(html.includes('tab-deck'), 'El script debe enlazar con los selectores');
});

test('HTML-08: Visualización en Mosaico y Listado detallado preserva todas las ideas', () => {
  const activity = {
    id: 'act-all-ideas',
    public_code: 'IDEAS01',
    title: 'Verificación de ideas completas',
    question: '¿Se conservan todas?',
    status: 'open',
    created_at: '2026-11-01T12:00:00Z'
  };
  const ideas = [
    { id: '1', content: 'Primera propuesta comunitaria', status: 'published', created_at: '2026-11-01T10:00:00Z', published_at: null, idea_number: 1 },
    { id: '2', content: 'Segunda propuesta barrial', status: 'published', created_at: '2026-11-01T11:00:00Z', published_at: null, idea_number: 2 }
  ];
  const html = generateHtmlSlideDeck(activity, ideas, 'published');

  // Mosaico
  assert.ok(html.includes('mosaic-grid'), 'Debe incluir la grilla de mosaico');
  assert.ok(html.includes('Primera propuesta comunitaria'));
  assert.ok(html.includes('Segunda propuesta barrial'));
  assert.ok(html.includes('#1'));
  assert.ok(html.includes('#2'));

  // Listado
  assert.ok(html.includes('list-container'), 'Debe incluir el contenedor de listado');
  assert.ok(html.includes('list-item'));
});

test('HTML-09: Análisis de resultados con cálculos reales y transparencia metodológica', () => {
  const activity = {
    id: 'act-analytics',
    public_code: 'STATS01',
    title: 'Auditoría de estadísticas reales',
    question: '¿Los números son exactos?',
    status: 'open',
    created_at: '2026-11-01T12:00:00Z'
  };
  const ideas = [
    { id: '1', content: 'Breve', status: 'published', created_at: '2026-11-01T10:00:00Z', published_at: null }, // 5 caracteres
    { id: '2', content: 'Esta es una idea de longitud intermedia exactamente calculada', status: 'published', created_at: '2026-11-01T12:00:00Z', published_at: null } // 62 caracteres
  ];
  const html = generateHtmlSlideDeck(activity, ideas, 'published');

  // Total real de ideas
  assert.ok(html.includes('<span class="kpi-value">2</span>'), 'Debe mostrar el total real de 2 ideas');
  // Longitud promedio: (5 + 61) / 2 = 66 / 2 = 33 caracteres
  assert.ok(html.includes('<span class="kpi-value">33</span>'), 'Debe calcular el promedio real de 33 caracteres');
  // Rango de extensión: min 5, max 61
  assert.ok(html.includes('5 – 61'), 'Debe indicar el rango exacto de caracteres');
  // Nota metodológica
  assert.ok(html.includes('Transparencia metodológica'), 'Debe contener la declaración de transparencia');
  assert.ok(html.includes('no infiere, estima ni inventa tendencias'), 'Debe certificar el rigor de no inventar datos');
});

test('HTML-10: Prevención de inyección XSS en todas las 4 modalidades', () => {
  const activity = {
    id: 'act-xss',
    public_code: 'XSS01',
    title: '<script>alert("titulo")</script>',
    question: '<b onmouseover=alert(1)>pregunta</b>',
    status: 'open',
    created_at: '2026-11-01T12:00:00Z'
  };
  const ideas = [
    {
      id: '1',
      content: '<img src=x onerror="malicious()"><svg onload="exploit()">',
      status: 'published',
      created_at: '2026-11-01T10:00:00Z',
      published_at: null
    }
  ];
  const html = generateHtmlSlideDeck(activity, ideas, 'published');

  assert.ok(!html.includes('<script>alert("titulo")</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;titulo&quot;)&lt;/script&gt;'));
  assert.ok(!html.includes('<img src=x onerror="malicious()">'));
  assert.ok(!html.includes('<svg onload="exploit()">'));
  assert.ok(html.includes('&lt;img src=x onerror=&quot;malicious()&quot;&gt;'));
});

test('HTML-11: Reglas de impresión y exportación a PDF (@media print)', () => {
  const activity = {
    id: 'act-print',
    public_code: 'PRINT01',
    title: 'Impresión y PDF',
    question: '¿Se imprime correctamente?',
    status: 'open',
    created_at: '2026-11-01T12:00:00Z'
  };
  const ideas = [
    { id: '1', content: 'Idea para reporte impreso', status: 'published', created_at: '2026-11-01T10:00:00Z', published_at: null }
  ];
  const html = generateHtmlSlideDeck(activity, ideas, 'published');

  // Regla @media print presente
  assert.ok(html.includes('@media print'), 'Debe incluir bloque @media print');

  // Ocultamiento de cabecera, selector de modalidades y navegación de diapositivas
  assert.ok(html.includes('.app-header,'), 'Debe ocultar cabecera persistente en impresión');
  assert.ok(html.includes('.deck-nav,'), 'Debe ocultar controles de navegación en impresión');
  assert.ok(html.includes('display: none !important;'), 'Debe forzar display none en elementos no imprimibles');

  // Modo Presentación imprime todas las diapositivas
  assert.ok(html.includes('#view-presentation .slide'), 'Debe estilizar slides para impresión');
  assert.ok(html.includes('page-break-after: always;') || html.includes('break-after: page;'), 'Debe paginar cada slide en impresión');

  // Evitar cortes de página en tarjetas
  assert.ok(html.includes('page-break-inside: avoid;') || html.includes('break-inside: avoid;'), 'Debe evitar corte de tarjetas entre páginas');
});

test('HTML-12: Accesibilidad del selector de pestañas (tablist, tabindex y flechas)', () => {
  const activity = {
    id: 'act-a11y-tabs',
    public_code: 'TABS01',
    title: 'Navegación de pestañas',
    question: '¿Cumple WAI-ARIA?',
    status: 'open',
    created_at: '2026-11-01T12:00:00Z'
  };
  const html = generateHtmlSlideDeck(activity, [], 'published');

  // Estado inicial de tabindex en pestañas
  assert.ok(html.includes('id="tab-deck" role="tab" aria-selected="true" tabindex="0"'), 'Pestaña activa inicial debe tener tabindex="0"');
  assert.ok(html.includes('id="tab-mosaic" role="tab" aria-selected="false" tabindex="-1"'), 'Pestaña inactiva debe tener tabindex="-1"');
  assert.ok(html.includes('id="tab-list" role="tab" aria-selected="false" tabindex="-1"'), 'Pestaña listado debe tener tabindex="-1"');
  assert.ok(html.includes('id="tab-analytics" role="tab" aria-selected="false" tabindex="-1"'), 'Pestaña análisis debe tener tabindex="-1"');

  // Gestión de tabindex en JavaScript al cambiar de pestaña
  assert.ok(html.includes("setAttribute('tabindex', '0')"), 'Debe asignar tabindex 0 a la pestaña seleccionada');
  assert.ok(html.includes("setAttribute('tabindex', '-1')"), 'Debe asignar tabindex -1 a las pestañas no seleccionadas');

  // Navegación por flechas en la barra de pestañas
  assert.ok(html.includes("e.key === 'ArrowRight'"), 'Debe soportar flecha derecha en pestañas');
  assert.ok(html.includes("e.key === 'ArrowLeft'"), 'Debe soportar flecha izquierda en pestañas');

  // Prevención de conflictos con la navegación de diapositivas
  assert.ok(html.includes("closest('.modes-selector')"), 'La navegación de diapositivas debe ignorar eventos con foco en las pestañas');
});
