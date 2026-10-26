import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Actividad no encontrada — Muro común",
};

export default function NotFound() {
  async function searchAction(formData: FormData) {
    "use server";
    const raw = String(formData.get("code") ?? "");
    const clean = raw
      .trim()
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();
    if (clean) {
      redirect(`/a/${clean}`);
    }
  }

  return (
    <main className="auth-layout">
      <Link className="brand brand-dark" href="/">
        <span className="brand-mark">
          m<span>.</span>
        </span>
        <span>
          muro<span className="brand-light">común</span>
        </span>
      </Link>

      <section className="auth-card" style={{ maxWidth: "480px" }}>
        <div className="eyebrow">404 · CONVERSACIÓN NO ENCONTRADA</div>
        <h1>No encontramos esa actividad</h1>
        <p>
          El código ingresado no corresponde a ninguna actividad disponible o la
          dirección no existe.
        </p>

        <form
          action={searchAction}
          className="stack-form"
          style={{ marginTop: "20px" }}
        >
          <label
            htmlFor="retry-code-input"
            style={{ fontWeight: 600, fontSize: "13px" }}
          >
            Reintentar con otro código
            <input
              id="retry-code-input"
              name="code"
              type="text"
              placeholder="Ej: W7K9Q2M4"
              maxLength={16}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              autoComplete="off"
              required
              style={{
                marginTop: "6px",
                letterSpacing: "2.5px",
                fontFamily: "monospace",
                fontWeight: 700,
                fontSize: "17px",
                textAlign: "center",
                textTransform: "uppercase",
                padding: "12px 14px",
              }}
            />
          </label>

          <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
            <Link
              className="button button-quiet button-small"
              href="/"
              style={{ flex: 1 }}
            >
              ← Volver al inicio
            </Link>
            <button
              type="submit"
              className="button button-primary button-small"
              style={{ flex: 1.3 }}
            >
              Buscar actividad ↗
            </button>
          </div>
        </form>
      </section>

      <p className="auth-footer">Una conversación abierta.</p>
    </main>
  );
}
