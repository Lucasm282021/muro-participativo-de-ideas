import Link from "next/link";
import "./admin.css";

export const metadata = {
  title: "403 — Acceso Restringido",
  description: "Se requieren permisos de administración global.",
};

export default function Forbidden() {
  return (
    <main className="dashboard-page">
      <header className="dashboard-nav">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link className="brand brand-dark" href="/">
            <span className="brand-mark">
              m<span>.</span>
            </span>
            <span>
              muro<span className="brand-light">común</span>
            </span>
          </Link>
          <span className="admin-badge-preview">403 · Restringido</span>
        </div>

        <div className="nav-actions">
          <Link className="nav-signin" href="/panel">
            ← Mi Panel
          </Link>
          <Link className="nav-signin" href="/">
            Inicio
          </Link>
        </div>
      </header>

      <section className="dashboard-main">
        <div className="dashboard-heading">
          <div>
            <div className="eyebrow">CONTROL DE ACCESO INSTITUCIONAL</div>
            <h1>
              Acceso Restringido
              <br />
              <em>Se requiere autorización global.</em>
            </h1>
          </div>
          <span className="dashboard-mark">🔒</span>
        </div>

        <div className="admin-error-notice" style={{ marginTop: "20px" }}>
          <span className="admin-notice-icon" aria-hidden="true">
            🚫
          </span>
          <div>
            <h4>Permisos insuficientes para consultar esta sección</h4>
            <p>
              El panel de administración global está reservado exclusivamente
              para identidades con el rol <code>admin_global</code> acreditado
              en la base de datos. Tu cuenta no cuenta con este privilegio o la
              verificación de autorización en el servidor no fue satisfactoria.
            </p>
          </div>
        </div>

        <div style={{ marginTop: "28px", display: "flex", gap: "12px" }}>
          <Link
            href="/panel"
            className="nav-signin"
            style={{
              display: "inline-block",
              background: "var(--ink)",
              color: "#fff",
              padding: "10px 18px",
              borderRadius: "4px",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            ← Volver a Mi Panel
          </Link>
          <Link
            href="/"
            className="nav-signin"
            style={{
              display: "inline-block",
              padding: "10px 18px",
              borderRadius: "4px",
              textDecoration: "none",
              color: "var(--ink)",
              border: "1px solid #d9d5c5",
            }}
          >
            Ir a la portada
          </Link>
        </div>
      </section>
    </main>
  );
}
