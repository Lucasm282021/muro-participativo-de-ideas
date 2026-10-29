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

