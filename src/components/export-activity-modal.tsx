"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ExportActivityModalProps {
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

interface ModalInternalProps extends ExportActivityModalProps {
  onClose: () => void;
}

function ExportActivityModal({
  activityId,
  activityTitle,
  publicCode,
  onClose,
}: ModalInternalProps) {
  const [mounted, setMounted] = useState(false);
  const [format, setFormat] = useState<"csv" | "html">("csv");
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

        if (response.status === 404) {
          setError("No se encontró la actividad o no tenés permisos para exportarla.");
          setLoading(false);
          return;
        }

        setError("Ocurrió un error al generar la exportación. Intentalo de nuevo.");
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
      setError("Error de conexión al descargar. Verificá tu red y probá nuevamente.");
      setLoading(false);
    }
  };

  if (!mounted) return null;

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
              Exportar resultados de la actividad
            </h2>
            <p className="delete-modal-subtitle">
              Actividad: <strong>“{activityTitle}”</strong>
            </p>
          </div>
        </div>

        <div id="export-dialog-desc" className="delete-modal-body">
          <fieldset className="export-fieldset">
            <legend className="export-legend">Formato de exportación</legend>
            <div className="export-radio-group">
              <label className="export-radio-label">
                <input
                  type="radio"
                  name="export-format"
                  value="csv"
                  checked={format === "csv"}
                  onChange={() => setFormat("csv")}
                  disabled={loading}
                />
                <div>
                  <strong>CSV (.csv) — Planilla de cálculo</strong>
                  <p>
                    Compatible con Excel y Google Sheets. Delimitado por punto y coma (;) con codificación UTF-8 y protección contra fórmulas.
                  </p>
                </div>
              </label>
              <label className="export-radio-label">
                <input
                  type="radio"
                  name="export-format"
                  value="html"
                  checked={format === "html"}
                  onChange={() => setFormat("html")}
                  disabled={loading}
                />
                <div>
                  <strong>HTML (.html) — Presentación de diapositivas</strong>
                  <p>
                    Documento autocontenido con navegación por teclado y controles. Funciona sin conexión a internet y se adapta a la extensión de las ideas.
                  </p>
                </div>
              </label>
            </div>
          </fieldset>

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
                  Por defecto solo se exportan las ideas publicadas en el muro. Al marcar esta opción, cada idea identificará explícitamente su estado.
                </span>
              </span>
            </label>
          </fieldset>

          <div className="export-privacy-notice" role="note">
            <span>🔒</span>
            <p>
              <strong>Privacidad garantizada:</strong> Los nombres, direcciones de correo electrónico y datos personales de los participantes nunca se incluyen en los archivos exportados.
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
            {loading ? "Generando descarga…" : "Descargar archivo"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

