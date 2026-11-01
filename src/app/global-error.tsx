"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            fontFamily: "system-ui, -apple-system, sans-serif",
            textAlign: "center",
            backgroundColor: "#f9fafb",
            color: "#111827",
          }}
        >
          <h2 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "8px" }}>
            Ha ocurrido un error inesperado
          </h2>
          <p style={{ color: "#4b5563", marginBottom: "24px", maxWidth: "480px" }}>
            Se produjo un error crítico en la aplicación. Puedes intentar recargar la vista.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "10px 20px",
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "#ffffff",
              backgroundColor: "#2563eb",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
