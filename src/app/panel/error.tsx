"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error no controlado capturado en el panel:", error);
  }, [error]);

  return (
    <main
      className="dashboard-page"
      style={{
        padding: "48px 24px",
        maxWidth: "600px",
        margin: "0 auto",
      }}
    >
      <div
        className="auth-card"
        role="alert"
        aria-live="assertive"
        style={{ width: "100%" }}
      >
        <div className="eyebrow">ERROR EN EL PANEL</div>
        <h1 style={{ fontSize: "20px", margin: "12px 0 8px" }}>
          No se pudo completar la operación
        </h1>
        <p
          style={{
            color: "#6e6d62",
            fontSize: "14px",
            lineHeight: "1.5",
            marginBottom: "20px",
          }}
        >
          Ocurrió un problema de comunicación o carga al procesar los datos del
          panel. Tus datos no se han perdido. Podés intentar recargar la vista o
          regresar al listado.
        </p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="button button-primary"
            onClick={() => reset()}
          >
            Reintentar
          </button>
          <Link href="/panel" className="button button-quiet">
            Ir al inicio del panel
          </Link>
        </div>
      </div>
    </main>
  );
}
