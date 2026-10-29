export type ExportableIdea = {
  id: string;
  content: string;
  status: "pending" | "published" | "hidden";
  created_at: string;
  published_at: string | null;
};

export const STATUS_LABELS: Record<ExportableIdea["status"], string> = {
  published: "Publicada",
  pending: "Pendiente",
  hidden: "Oculta",
};

/**
 * Sanitiza un valor para CSV asegurando:
 * 1. Protección contra inyección de fórmulas en hojas de cálculo (CSV Injection / DDE).
 *    Si el texto inicia con '=', '+', '-', '@', '\t' o '\r', se antepone un apóstrofe de neutralización.
 * 2. Escape de comillas dobles internas (duplicándolas: " -> "").
 * 3. Envoltura completa entre comillas dobles para admitir saltos de línea y el delimitador ';'.
 */
export function sanitizeCsvField(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return '""';
  let str = String(value);

  // Protección reforzada contra CSV Injection (DDE):
  // Detecta disparadores peligrosos (=, +, -, @, \t, \r) de forma directa
  // o si van precedidos por espacios en blanco / espacios no separables
  const formulaTriggers = ["=", "+", "-", "@", "\t", "\r"];
  const isDirect = formulaTriggers.some((t) => str.startsWith(t));
  const trimmed = str.replace(/^[ \u00A0]+/, "");
  const isTrimmedTrigger = formulaTriggers.some((t) => trimmed.startsWith(t));

  if (isDirect || isTrimmedTrigger) {
    str = `'${str}`;
  }

  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toISOString().replace("T", " ").replace(/\..+/, "");
  } catch {
    return isoString ?? "";
  }
}

/**
 * Genera el contenido completo de un archivo CSV con:
 * - Marcador de orden de bytes (BOM UTF-8: \uFEFF) para apertura directa en Excel sin corrupción de tildes ni eñes.
 * - Delimitador ';' conforme a la configuración regional estándar de Argentina/Hispanoamérica.
 * - Exclusión total de datos personales (nombres, correos).
 */
export function generateCsv(
  ideas: ExportableIdea[],
  scope: "published" | "all" = "published",
): string {
  const BOM = "\uFEFF";
  const DELIMITER = ";";

  const rows: string[] = [];

  if (scope === "all") {
    rows.push(
      [
        sanitizeCsvField("Nro"),
        sanitizeCsvField("Idea"),
        sanitizeCsvField("Estado"),
        sanitizeCsvField("Fecha de envío"),
        sanitizeCsvField("Fecha de publicación"),
      ].join(DELIMITER),
    );

    ideas.forEach((idea, index) => {
      rows.push(
        [
          sanitizeCsvField(index + 1),
          sanitizeCsvField(idea.content),
          sanitizeCsvField(STATUS_LABELS[idea.status] ?? idea.status),
          sanitizeCsvField(formatDate(idea.created_at)),
          sanitizeCsvField(formatDate(idea.published_at)),
        ].join(DELIMITER),
      );
    });
  } else {
    rows.push(
      [
        sanitizeCsvField("Nro"),
        sanitizeCsvField("Idea"),
        sanitizeCsvField("Fecha de publicación"),
      ].join(DELIMITER),
    );

    ideas.forEach((idea, index) => {
      rows.push(
        [
          sanitizeCsvField(index + 1),
          sanitizeCsvField(idea.content),
          sanitizeCsvField(formatDate(idea.published_at ?? idea.created_at)),
        ].join(DELIMITER),
      );
    });
  }

  return `${BOM}${rows.join("\r\n")}\r\n`;
}
