import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Lectura del componente para análisis estático e inspección de estructura
const componentPath = path.join(process.cwd(), 'src', 'components', 'export-activity-modal.tsx');
const componentContent = fs.readFileSync(componentPath, 'utf8');

test('MODAL-01: Selección inicial predeterminada en HTML interactivo', () => {
  // Debe inicializar useState con "html"
  assert.ok(
    componentContent.includes('useState<"csv" | "html">("html")'),
    'El estado inicial debe ser "html"'
  );
  // El botón de descarga inicial debe indicar "Exportar HTML"
  assert.ok(
    componentContent.includes('"Exportar HTML"'),
    'Debe contemplar la etiqueta "Exportar HTML"'
  );
});

test('MODAL-02: Selector de formatos siempre accesible con opciones HTML y CSV', () => {
  // Debe contener fieldset con legend de formato
  assert.ok(
    componentContent.includes('Formato de exportación'),
    'Debe incluir el fieldset de formato de exportación'
  );
  // Debe renderizar radio buttons para html y csv
  assert.ok(componentContent.includes('value="html"'), 'Debe existir opción HTML');
  assert.ok(componentContent.includes('value="csv"'), 'Debe existir opción CSV');
  // Badges identificatorios
  assert.ok(componentContent.includes('export-badge-html'), 'Badge de HTML');
  assert.ok(componentContent.includes('export-badge-csv'), 'Badge de CSV');
});

test('MODAL-03: Botón de acción principal dinámico y acción secundaria Cancelar', () => {
  // Lógica de etiqueta del botón según formato
  assert.ok(
    componentContent.includes('mainButtonLabel'),
    'Debe calcular dinámicamente la etiqueta del botón principal'
  );
  assert.ok(
    componentContent.includes('"Exportar HTML"') && componentContent.includes('"Exportar CSV"'),
    'Debe contemplar tanto "Exportar HTML" como "Exportar CSV"'
  );
  assert.ok(
    componentContent.includes('"Generando descarga…"'),
    'Debe mostrar mensaje de carga mientras se genera la descarga'
  );
  // Acción secundaria
  assert.ok(
    componentContent.includes('>Cancelar</button>') || componentContent.includes('Cancelar'),
    'Debe incluir botón Cancelar como acción secundaria'
  );
});

test('MODAL-04: Contenido contextual enriquecido para modalidad HTML interactivo', () => {
  // Título y 4 modalidades
  assert.ok(
    componentContent.includes('Una exportación, cuatro formas de explorar la información:'),
    'Debe incluir el título de las 4 modalidades'
  );
  assert.ok(componentContent.includes('Presentación'), 'Debe listar Presentación');
  assert.ok(componentContent.includes('Mosaico de ideas'), 'Debe listar Mosaico');
  assert.ok(componentContent.includes('Listado detallado'), 'Debe listar Listado');
  assert.ok(componentContent.includes('Análisis de resultados'), 'Debe listar Análisis');

  // Píldoras de características clave
  assert.ok(
    componentContent.includes('Diseñado para celulares, tablets y computadoras'),
    'Píldora multi-dispositivo'
  );
  assert.ok(
    componentContent.includes('Sin conexión a Internet'),
    'Píldora autónomo offline'
  );
  assert.ok(
    componentContent.includes('4 vistas en 1 archivo'),
    'Píldora todo en uno'
  );
  assert.ok(
    componentContent.includes('Impresión y PDF'),
    'Píldora de soporte de impresión'
  );
});

test('MODAL-05: Contenido contextual enfocado para modalidad CSV tabular', () => {
  assert.ok(
    componentContent.includes('hoja de') && componentContent.includes('cálculo'),
    'Descripción clara de hoja de cálculo'
  );
  assert.ok(
    componentContent.includes('Microsoft Excel') && componentContent.includes('Google Sheets'),
    'Compatibilidad con planillas de cálculo'
  );
  assert.ok(
    componentContent.includes('Delimitado por punto y coma (;)'),
    'Delimitador regional argentino'
  );
  assert.ok(
    componentContent.includes('Codificación UTF-8 con BOM'),
    'BOM UTF-8 para compatibilidad'
  );
});

test('MODAL-06: Conservación del selector de alcance y adaptación textual contextual', () => {
  assert.ok(
    componentContent.includes('Alcance de las ideas'),
    'Debe incluir el fieldset de alcance'
  );
  assert.ok(
    componentContent.includes('Incluir ideas pendientes y ocultas'),
    'Checkbox de alcance'
  );
  // Adaptación según includeAll
  assert.ok(
    componentContent.includes('Por defecto solo se exportan las ideas publicadas visibles en el muro.'),
    'Explicación cuando includeAll es false'
  );
  assert.ok(
    componentContent.includes('Se exportarán todas las ideas registradas (publicadas, pendientes de moderación y ocultas)'),
    'Explicación cuando includeAll es true'
  );
});

test('MODAL-07: Preservación de aviso de privacidad y protección de datos', () => {
  assert.ok(
    componentContent.includes('Protección de datos personales:'),
    'Encabezado de aviso de privacidad claro y visible'
  );
  assert.ok(
    componentContent.includes('datos de identificación de las cuentas'),
    'Exclusión transparente de cuentas de usuario y correos'
  );
  assert.ok(
    componentContent.includes('tal como fue enviado'),
    'Advertencia precisa sobre datos personales escritos voluntariamente en el cuerpo de las ideas'
  );
  assert.ok(
    componentContent.includes('role="note"'),
    'Semántica accesible para la nota de privacidad'
  );
});

test('MODAL-08: Accesibilidad ARIA, focus trap y control de teclado', () => {
  assert.ok(componentContent.includes('role="dialog"'), 'Debe tener role="dialog"');
  assert.ok(componentContent.includes('aria-modal="true"'), 'Debe ser modal nativo accesible');
  assert.ok(componentContent.includes('aria-labelledby="export-dialog-title"'), 'Título asociado');
  assert.ok(componentContent.includes('aria-describedby="export-dialog-desc"'), 'Descripción asociada');
  assert.ok(componentContent.includes('aria-live="polite"'), 'Panel contextual anunciado a lectores');
  assert.ok(componentContent.includes('event.key === "Escape"'), 'Manejo de tecla Escape');
  assert.ok(componentContent.includes('event.key === "Tab"'), 'Trampa de foco Tab');
  assert.ok(componentContent.includes('cancelBtnRef.current?.focus()'), 'Foco inicial seguro en Cancelar');
});

test('MODAL-09: No regresión en el flujo de descarga y manejo de errores HTTP', () => {
  // Construcción de la URL de descarga
  assert.ok(
    componentContent.includes('`/panel/actividad/${activityId}/exportar?format=${format}&scope=${scope}`'),
    'Construcción de URL al endpoint oficial'
  );
  // Descarga mediante Blob
  assert.ok(componentContent.includes('response.blob()'), 'Lectura de blob binario');
  assert.ok(componentContent.includes('window.URL.createObjectURL(blob)'), 'Generación de ObjectURL');
  assert.ok(componentContent.includes('window.URL.revokeObjectURL(url)'), 'Liberación de memoria');
  // Manejo de estados de error específicos
  assert.ok(componentContent.includes('response.status === 413'), 'Manejo de desbordamiento 413');
  assert.ok(componentContent.includes('response.status === 409'), 'Manejo de concurrencia 409');
  assert.ok(componentContent.includes('response.status === 404'), 'Manejo de no encontrado 404');
});
