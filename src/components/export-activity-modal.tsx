"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ExportActivityModalProps {
  activityId: string;
  activityTitle: string;
  publicCode: string;
}

export function ExportActivityButton({
  activityId,
  activityTitle,
  publicCode,
}: ExportActivityModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="button button-quiet"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
      >
        Exportar resultados ↓
      </button>

      {isOpen && (
        <ExportActivityModal
          activityId={activityId}
          activityTitle={activityTitle}
          publicCode={publicCode}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}

export interface ModalInternalProps extends ExportActivityModalProps {
  onClose: () => void;
}

export function ExportActivityModal({
  activityId,
  activityTitle,
  publicCode,
  onClose,
}: ModalInternalProps) {
  const [mounted, setMounted] = useState(false);
  const [format, setFormat] = useState<"csv" | "html">("html");
  const [includeAll, setIncludeAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Foco inicial en el botón de cancelar por seguridad y accesibilidad
    const timer = setTimeout(() => {
      cancelBtnRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Escape key y trampa de foco
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        event.preventDefault();
        onClose();
      }

      if (event.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [loading, onClose]);

  const handleDownload = async () => {
    setLoading(true);
    setError(null);

    try {
      const scope = includeAll ? "all" : "published";
      const endpoint = `/panel/actividad/${activityId}/exportar?format=${format}&scope=${scope}`;
      const response = await fetch(endpoint, {
        method: "GET",
      });

      if (!response.ok) {
        if (response.status === 413) {
          const body = await response.json().catch(() => null);
          setError(
            body?.message ??
              "La actividad supera el límite máximo de 5.000 ideas para exportación directa.",
          );
          setLoading(false);
          return;
        }

        if (response.status === 409) {
          const body = await response.json().catch(() => null);
          setError(
            body?.message ??
              "No se pudo garantizar la integridad completa de la exportación debido a cambios concurrentes. Por favor, reintentá la descarga.",
          );
          setLoading(false);
          return;
        }

        if (response.status === 404) {
          setError(
            "No se encontró la actividad o no tenés permisos para exportarla.",
          );
          setLoading(false);
          return;
        }

        setError(
          "Ocurrió un error al generar la exportación. Intentalo de nuevo.",
        );
        setLoading(false);
        return;
      }

      // Descargar archivo
      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition");
      let filename = `muro-${publicCode || "actividad"}-${new Date().toISOString().slice(0, 10)}.${format}`;

      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^";]+)"?/);
        if (match?.[1]) {
          filename = match[1];
        }
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setLoading(false);
      onClose();
    } catch {
      setError(
        "Error de conexión al descargar. Verificá tu red y probá nuevamente.",
      );
      setLoading(false);
    }
  };

  if (!mounted) return null;

  const mainButtonLabel = loading
    ? "Generando descarga…"
    : format === "html"
      ? "Exportar HTML"
      : "Exportar CSV";

  return createPortal(
    <div className="delete-modal-backdrop">
      <div
        ref={dialogRef}
        className="delete-modal-card export-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        aria-describedby="export-dialog-desc"
      >
        <div className="delete-modal-header">
          <span
            className="delete-modal-badge export-modal-badge"
            aria-hidden="true"
          >
            ↓
          </span>
          <div>
            <h2 id="export-dialog-title" className="delete-modal-title">
              Exportar resultados
            </h2>
            <p className="delete-modal-subtitle">
              Elegí cómo querés llevarte la información de esta actividad:{" "}
              <strong>“{activityTitle}”</strong>
            </p>
          </div>
        </div>

        <div id="export-dialog-desc" className="delete-modal-body">
          <fieldset className="export-fieldset">
            <legend className="export-legend">Formato de exportación</legend>
            <div className="export-radio-group">
              <label
                className={`export-radio-card ${format === "html" ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="export-format"
                  value="html"
                  checked={format === "html"}
                  onChange={() => setFormat("html")}
                  disabled={loading}
                />
                <div className="export-radio-content">
                  <div className="export-radio-title-row">
                    <span className="export-format-badge export-badge-html">
                      HTML
                    </span>
                    <strong>HTML interactivo</strong>
                  </div>
                  <p>
                    Documento autónomo con cuatro modalidades de visualización
                    para consultar, presentar y compartir.
                  </p>
                </div>
              </label>

              <label
                className={`export-radio-card ${format === "csv" ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="export-format"
                  value="csv"
                  checked={format === "csv"}
                  onChange={() => setFormat("csv")}
                  disabled={loading}
                />
                <div className="export-radio-content">
                  <div className="export-radio-title-row">
                    <span className="export-format-badge export-badge-csv">
                      CSV
                    </span>
                    <strong>Planilla de cálculo</strong>
                  </div>
                  <p>
                    Datos organizados para abrir, filtrar y trabajar en Excel o
                    Google Sheets.
                  </p>
                </div>
              </label>
            </div>
          </fieldset>

          {/* Bloque contextual según formato seleccionado */}
          {format === "html" ? (
            <div className="export-context-panel" aria-live="polite">
              <h3 className="export-context-title">
                Una exportación, cuatro formas de explorar la información:
              </h3>
              <div className="export-modes-grid">
                <div className="export-mode-item">
                  <span className="export-mode-icon" aria-hidden="true">
                    📽️
                  </span>
                  <div>
                    <strong>Presentación</strong>
                    <p>Recorré las ideas en formato de diapositivas.</p>
                  </div>
                </div>
                <div className="export-mode-item">
                  <span className="export-mode-icon" aria-hidden="true">
                    🗂️
                  </span>
                  <div>
                    <strong>Mosaico de ideas</strong>
                    <p>Visualizá las propuestas en tarjetas.</p>
                  </div>
                </div>
                <div className="export-mode-item">
                  <span className="export-mode-icon" aria-hidden="true">
                    📋
                  </span>
                  <div>
                    <strong>Listado detallado</strong>
                    <p>
                      {includeAll
                        ? "Consultá todas las ideas (publicadas y moderadas) en formato organizado."
                        : "Consultá las ideas publicadas en un formato organizado."}
                    </p>
                  </div>
                </div>
                <div className="export-mode-item">
                  <span className="export-mode-icon" aria-hidden="true">
                    📊
                  </span>
                  <div>
                    <strong>Análisis de resultados</strong>
                    <p>
                      Explorá métricas y estadísticas calculadas a partir de la
                      información disponible.
                    </p>
                  </div>
                </div>
              </div>

              <div className="export-features-strip">
                <span className="export-pill">
                  📱 Diseñado para celulares, tablets y computadoras
                </span>
                <span className="export-pill">
                  ⚡ Sin conexión a Internet
                </span>
                <span className="export-pill">
                  🔄 4 vistas en 1 archivo
                </span>
                <span className="export-pill">
                  🖨️ Impresión y PDF
                </span>
              </div>
            </div>
          ) : (
            <div className="export-context-panel" aria-live="polite">
              <h3 className="export-context-title">
                Datos estructurados para planilla
              </h3>
              <p className="export-csv-desc">
                Datos organizados para abrir, filtrar y trabajar en una hoja de
                cálculo.
              </p>
              <ul className="export-csv-features">
                <li>
                  Compatible con Microsoft Excel, Google Sheets y LibreOffice
                  Calc.
                </li>
                <li>
                  Delimitado por punto y coma (;) conforme a la configuración
                  regional argentina.
                </li>
                <li>
                  Codificación UTF-8 con BOM para preservación nítida de tildes
                  y emojis.
                </li>
                <li>Protección contra inyección de fórmulas (CSV / DDE).</li>
              </ul>
            </div>
          )}

          <fieldset className="export-fieldset">
            <legend className="export-legend">Alcance de las ideas</legend>
            <label className="delete-modal-checkbox-label">
              <input
                type="checkbox"
                checked={includeAll}
                onChange={(e) => setIncludeAll(e.target.checked)}
                disabled={loading}
              />
              <span>
                <strong>Incluir ideas pendientes y ocultas</strong>
                <br />
                <span style={{ fontSize: "12px", color: "#666" }}>
                  {includeAll
                    ? "Se exportarán todas las ideas registradas (publicadas, pendientes de moderación y ocultas), identificando el estado de cada una."
                    : "Por defecto solo se exportan las ideas publicadas visibles en el muro. Al marcar esta opción, se incluirán también las pendientes y ocultas."}
                </span>
              </span>
            </label>
          </fieldset>

          <div className="export-privacy-notice" role="note">
            <span aria-hidden="true">🔒</span>
            <p>
              <strong>Protección de datos personales:</strong> La exportación no
              incluye los datos de identificación de las cuentas de los
              participantes (como nombres o correos electrónicos). El contenido
              de las ideas se exporta tal como fue enviado; si un autor incluyó
              datos personales dentro de su texto, estos aparecerán en el
              archivo exportado.
            </p>
          </div>

          {error && (
            <div className="delete-modal-error" role="alert">
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="delete-modal-actions">
          <button
            ref={cancelBtnRef}
            type="button"
            className="button button-quiet"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={handleDownload}
            disabled={loading}
            aria-busy={loading}
          >
            {mainButtonLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
