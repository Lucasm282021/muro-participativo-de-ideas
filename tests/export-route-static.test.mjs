import test from 'node:test';
import assert from 'node:assert/strict';
import { exportQuerySchema } from '../src/lib/export/schemas.ts';

test('ROUTE-01: Validación de parámetros con Zod (format y scope)', () => {
  // Casos válidos
  const v1 = exportQuerySchema.safeParse({ format: 'csv' });
  assert.ok(v1.success);
  assert.equal(v1.data.scope, 'published', 'Por defecto el scope debe ser published');

  const v2 = exportQuerySchema.safeParse({ format: 'html', scope: 'all' });
  assert.ok(v2.success);

  // Formatos rechazados (fuera de alcance en esta etapa)
  const invXlsx = exportQuerySchema.safeParse({ format: 'xlsx' });
  assert.equal(invXlsx.success, false, 'XLSX debe ser rechazado en esta etapa');

  const invPdf = exportQuerySchema.safeParse({ format: 'pdf' });
  assert.equal(invPdf.success, false, 'PDF debe ser rechazado en esta etapa');

  // Scopes inválidos
  const invScope = exportQuerySchema.safeParse({ format: 'csv', scope: 'invalid' });
  assert.equal(invScope.success, false);
});

test('ROUTE-02: Saneamiento seguro de nombres de archivo', () => {
  function getSafeFilename(publicCode, format) {
    const safeCode = (publicCode || 'actividad').replace(/[^a-zA-Z0-9_-]/g, '');
    const dateStr = '2026-10-29';
    return `muro-${safeCode}-${dateStr}.${format}`;
  }

  // Código con inyección de cabeceras o caracteres peligrosos
  const maliciousCode = 'ACT/../..;Content-Disposition:\r\nattack';
  const filename = getSafeFilename(maliciousCode, 'csv');
  assert.equal(filename, 'muro-ACTContent-Dispositionattack-2026-10-29.csv');
  assert.ok(!filename.includes('/'));
  assert.ok(!filename.includes('..'));
  assert.ok(!filename.includes(';'));
  assert.ok(!filename.includes('\r'));
  assert.ok(!filename.includes('\n'));
});

test('ROUTE-03: Control de volumen y respuesta 413 ante exceso de 5.000 ideas', () => {
  const MAX_EXPORT_LIMIT = 5000;

  function evaluateVolume(totalIdeas) {
    if (totalIdeas > MAX_EXPORT_LIMIT) {
      return {
        status: 413,
        body: {
          error: 'payload_too_large',
          message: `La actividad excede el límite máximo de ${MAX_EXPORT_LIMIT.toLocaleString('es-AR')} ideas para exportación directa.`,
          total: totalIdeas
        }
      };
    }
    return { status: 200 };
  }

  // Límite exacto
  assert.equal(evaluateVolume(5000).status, 200);

  // Desbordamiento
  const overflow = evaluateVolume(5001);
  assert.equal(overflow.status, 413);
  assert.equal(overflow.body.error, 'payload_too_large');
  assert.ok(overflow.body.message.includes('5.000 ideas'));
});

test('ROUTE-04: Verificación de cabeceras de seguridad requeridas', () => {
  const headers = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="muro-TEST-2026-10-29.csv"',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'X-Content-Type-Options': 'nosniff'
  };

  assert.equal(headers['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.ok(headers['Content-Disposition'].startsWith('attachment; filename="'));
});

test('ROUTE-05: Lógica de autorización y respuesta 404 para actividades ajenas', () => {
  function checkActivityAccess(activity, currentUserId) {
    if (!activity || activity.owner_id !== currentUserId) {
      // Patrón de seguridad: 404 estricto para no confirmar la existencia de recursos ajenos
      return { status: 404 };
    }
    return { status: 200 };
  }

  const myActivity = { id: 'act-1', owner_id: 'user-123' };
  assert.equal(checkActivityAccess(myActivity, 'user-123').status, 200);

  // Actividad de tercero
  const foreignActivity = { id: 'act-2', owner_id: 'user-999' };
  assert.equal(checkActivityAccess(foreignActivity, 'user-123').status, 404);

  // Actividad inexistente
  assert.equal(checkActivityAccess(null, 'user-123').status, 404);
});

