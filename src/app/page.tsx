import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <main className="landing-page">
      <nav className="site-nav">
        <Link className="brand brand-dark" href="/">
          <span className="brand-mark">
            m<span>.</span>
          </span>
          <span>
            muro<span className="brand-light">común</span>
          </span>
        </Link>
        <div className="nav-actions">
          {user ? (
            <Link className="button button-primary button-small" href="/panel">
              Ir a mi espacio <span>↗</span>
            </Link>
          ) : (
            <>
              <Link className="nav-signin" href="/ingresar">
                Ingresar
              </Link>
              <Link
                className="button button-primary button-small"
                href="/crear-cuenta"
              >
                Crear actividad <span>↗</span>
              </Link>
            </>
          )}
        </div>
      </nav>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-line" /> IDEAS EN COMÚN, EN TIEMPO REAL
          </div>
          <h1>
            Las mejores ideas
            <br />
            no aparecen en <span>silencio.</span>
          </h1>
          <p>
            Un espacio simple para escuchar a todos, construir ideas juntos y
            ver cómo una conversación se transforma en algo más.
          </p>
          <div className="hero-actions">
            <Link
              className="button button-primary"
              href={user ? "/panel" : "/crear-cuenta"}
            >
              Crear mi primera actividad <span>↗</span>
            </Link>
            <a className="text-link" href="#como-funciona">
              Conocé cómo funciona <span>↓</span>
            </a>
          </div>
          <div className="hero-proof">
            <div className="avatar-stack">
              <span>L</span>
              <span>M</span>
              <span>J</span>
              <span>+</span>
            </div>
            <span>
              Una voz abre el muro.
              <br />
              <strong>Las demás lo hacen crecer.</strong>
            </span>
          </div>
        </div>
        <div
          className="hero-visual"
          aria-label="Vista previa de un muro de ideas"
          role="img"
        >
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="visual-note note-a">
            <span>01</span>
            <p>Un espacio semanal para compartir lo que aprendimos</p>
            <b>✳</b>
          </div>
          <div className="visual-note note-b">
            <span>02</span>
            <p>Probar una idea pequeña antes de hacerla enorme</p>
            <b>↗</b>
          </div>
          <div className="visual-note note-c">
            <span>03</span>
            <p>Escuchar primero. Diseñar en equipo después.</p>
            <b>◌</b>
          </div>
          <div className="visual-stamp">
            <span>IDEAS</span>
            <strong>
              en
              <br />
              movimiento
            </strong>
            <i>✳</i>
          </div>
          <div className="visual-caption">
            <span className="live-dot" /> UN MURO. MUCHAS MIRADAS.
          </div>
        </div>
      </section>
      <section className="principles" id="como-funciona">
        <div className="section-kicker">01 — UNA MEJOR FORMA DE PARTICIPAR</div>
        <div className="principles-heading">
          <h2>
            De una pregunta
            <br />
            nace algo <em>compartido.</em>
          </h2>
          <p>
            Una actividad, un código y un muro que se va llenando frente a
            todos. Sin descargar nada. Sin perder ninguna voz.
          </p>
        </div>
        <div className="principle-grid">
          <article>
            <span className="principle-icon icon-circle">01</span>
            <h3>Abrí la conversación</h3>
            <p>
              Planteá una pregunta que invite a imaginar y compartí el acceso
              con tu grupo.
            </p>
          </article>
          <article>
            <span className="principle-icon icon-square">02</span>
            <h3>Dejá que aparezcan</h3>
            <p>
              Cada persona aporta desde su celular. Las ideas pueden publicarse
              directo o pasar por revisión.
            </p>
          </article>
          <article>
            <span className="principle-icon icon-star">03</span>
            <h3>Miralas crecer</h3>
            <p>
              El muro se actualiza en vivo y mantiene cada idea visible, sin
              exponer quién la escribió.
            </p>
          </article>
        </div>
      </section>
      <footer className="site-footer">
        <Link className="brand brand-dark" href="/">
          <span className="brand-mark">
            m<span>.</span>
          </span>
          <span>
            muro<span className="brand-light">común</span>
          </span>
        </Link>
        <span>Un lugar para pensar en voz alta.</span>
        <span>Hecho para escucharnos mejor.</span>
      </footer>
    </main>
  );
}
