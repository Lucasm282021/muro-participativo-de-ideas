import assert from "node:assert/strict";
import test from "node:test";
import { generateCsv, sanitizeCsvField } from "../src/lib/export/csv.ts";

test("CSV-01: El contenido inicia con BOM UTF-8 (\\uFEFF) para compatibilidad con Excel", () => {
  const result = generateCsv([]);
  assert.equal(
    result.charCodeAt(0),
    0xfeff,
    "El primer caracter debe ser el BOM UTF-8",
  );
});

test("CSV-02: Delimitador estándar punto y coma (;) conforme a la configuración regional argentina", () => {
  const ideas = [
    {
      id: "idea-1",
      content: "Idea simple",
      status: "published",
      created_at: "2026-10-29T10:00:00Z",
      published_at: "2026-10-29T10:05:00Z",
    },
  ];
  const csv = generateCsv(ideas, "published");
  const lines = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split("\r\n");
  assert.equal(lines.length, 2, "Debe contener encabezado y 1 fila de datos");
  assert.equal(lines[0], '"Nro";"Idea";"Fecha de publicación"');
  assert.ok(
    lines[1].startsWith('"1";"Idea simple";'),
    "Los campos se separan por ;",
  );
});

test("CSV-03: Protección estricta contra inyección de fórmulas (CSV Injection / DDE)", () => {
  // Disparadores peligrosos en planillas: =, +, -, @, tab (\t), retorno (\r)
  const dangerousDirectValues = [
    "=1+2",
    "+SUM(A1:A10)",
    "-10*5",
    "@SUM(A1)",
    "\tcmd.exe",
    "\rcalc.exe",
  ];

  for (const val of dangerousDirectValues) {
    const sanitized = sanitizeCsvField(val);
    assert.ok(
      sanitized.startsWith(`"'${val[0]}`),
      `El valor que inicia con ${JSON.stringify(val[0])} debe neutralizarse con apóstrofe inicial`,
    );
  }

  // Comportamiento normal con textos seguros
  const safeValues = [
    "Texto seguro",
    "   Texto con espacios iniciales",
    "5 + 5",
    "10 - 2",
    "contacto @ empresa",
  ];
  for (const val of safeValues) {
    const sanitized = sanitizeCsvField(val);
    assert.ok(
      !sanitized.startsWith("\"'"),
      `El valor seguro ${JSON.stringify(val)} no debe llevar apóstrofe de neutralización`,
    );
  }

  // Protección reforzada: disparadores con espacios, tabs, newlines y espacios Unicode iniciales
  const whitespaceDangerous = [
    "   =1+2",
    "  +SUM(B1:B5)",
    "   -calc",
    '  @HYPERLINK("http://evil.com")',
    "\t  =2*3",
    "\t\t+123",
    "\r\n=1",
    "\n-cmd",
    "\n@SUM",
    "\u00A0=1+1",
    "\u2000+calc",
    "\u2003@test",
    "\u200B-alert",
    "\u3000=A1",
  ];
  for (const val of whitespaceDangerous) {
    const sanitized = sanitizeCsvField(val);
    assert.ok(
      sanitized.startsWith("\"'"),
      `El valor con espacios o caracteres de control iniciales ${JSON.stringify(val)} debe neutralizarse con apóstrofe`,
    );
  }
});

test("CSV-04: Escape correcto de comillas dobles, saltos de línea y caracteres especiales", () => {
  const multilineIdea = 'Línea 1\nLínea 2 con "comillas" y punto y coma; fin.';
  const sanitized = sanitizeCsvField(multilineIdea);
  assert.ok(
    sanitized.includes('""comillas""'),
    "Las comillas dobles deben duplicarse",
  );
  assert.ok(
    sanitized.includes(";"),
    "El delimitador punto y coma se conserva dentro de comillas",
  );
  assert.ok(
    sanitized.startsWith('"') && sanitized.endsWith('"'),
    "El campo se envuelve en comillas",
  );
});

test("CSV-05: Preservación nítida de tildes, eñes y emojis (UTF-8)", () => {
  const specialIdea = [
    {
      id: "idea-special",
      content: "Añoranza, innovación y café con éxito 🚀💡",
      status: "published",
      created_at: "2026-10-29T12:00:00Z",
      published_at: "2026-10-29T12:00:00Z",
    },
  ];
  const csv = generateCsv(specialIdea, "published");
  assert.ok(csv.includes("Añoranza, innovación y café con éxito 🚀💡"));
});

test("CSV-06: Alcance predeterminado (published) omite columnas y filas de estados no publicados", () => {
  const ideas = [
    {
      id: "idea-pub",
      content: "Publicada",
      status: "published",
      created_at: "2026-10-29T10:00:00Z",
      published_at: "2026-10-29T10:05:00Z",
    },
  ];
  const csv = generateCsv(ideas, "published");
  assert.ok(
    !csv.includes('"Estado"'),
    "El CSV publicado por defecto no incluye columna de estado",
  );
});

test("CSV-07: Alcance explícito (all) incluye e identifica fielmente cada estado", () => {
  const ideas = [
    {
      id: "idea-1",
      content: "Publicada",
      status: "published",
      created_at: "2026-10-29T10:00:00Z",
      published_at: "2026-10-29T10:05:00Z",
    },
    {
      id: "idea-2",
      content: "Pendiente",
      status: "pending",
      created_at: "2026-10-29T10:01:00Z",
      published_at: null,
    },
    {
      id: "idea-3",
      content: "Oculta",
      status: "hidden",
      created_at: "2026-10-29T10:02:00Z",
      published_at: null,
    },
  ];
  const csv = generateCsv(ideas, "all");
  assert.ok(
    csv.includes('"Estado"'),
    "El CSV completo incluye columna de estado",
  );
  assert.ok(csv.includes('"Publicada"'));
  assert.ok(csv.includes('"Pendiente"'));
  assert.ok(csv.includes('"Oculta"'));
});

test("CSV-08: Ausencia absoluta de datos personales (nombres, emails)", () => {
  const ideas = [
    {
      id: "idea-1",
      content: "Una propuesta ciudadana",
      status: "published",
      created_at: "2026-10-29T10:00:00Z",
      published_at: "2026-10-29T10:05:00Z",
    },
  ];
  const csv = generateCsv(ideas, "published");
  assert.ok(!csv.toLowerCase().includes("email"));
  assert.ok(!csv.toLowerCase().includes("nombre"));
  assert.ok(!csv.toLowerCase().includes("apellido"));
  assert.ok(!csv.toLowerCase().includes("participante"));
});
