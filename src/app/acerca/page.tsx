import type { Metadata } from "next";
import Link from "next/link";
import { AboutContent } from "@/components/about-modal";

export const metadata: Metadata = {
  title: "Acerca de — Muro Participativo de Ideas",
  description: "Información sobre el producto, autoría y versión.",
};

export default function AcercaPage() {
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
      <section className="auth-card" style={{ maxWidth: "520px" }}>
        <AboutContent />

        <div style={{ marginTop: "24px" }}>
          <Link
            className="button button-primary button-small"
            href="/"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            ← Volver al inicio
          </Link>
        </div>
      </section>
      <p className="auth-footer">Una conversación abierta.</p>
    </main>
  );
}
