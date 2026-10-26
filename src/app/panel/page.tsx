import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { AboutModal } from "@/components/about-modal";
import { ActivityCard } from "@/components/activity-card";
import { ActivityForm } from "@/components/activity-form";
import { createClient } from "@/lib/supabase/server";
import type { Activity } from "@/lib/types";

export default async function OrganizerPanel() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/ingresar");
  const { data } = await supabase
    .from("activities")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  const activities = (data ?? []) as Activity[];

  return (
    <main className="dashboard-page">
      <header className="dashboard-nav">
        <Link className="brand brand-dark" href="/">
          <span className="brand-mark">
            m<span>.</span>
          </span>
          <span>
            muro<span className="brand-light">común</span>
          </span>
        </Link>
        <div className="nav-actions">
          <AboutModal
            triggerClassName="nav-signin"
            triggerText="Acerca de"
            triggerStyle={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          />
          <span className="account-email">{user.email}</span>
          <form action={signOutAction}>
            <button type="submit" className="nav-signin">
              Salir
            </button>
          </form>
        </div>
      </header>
      <section className="dashboard-main">
        <div className="dashboard-heading">
          <div>
            <div className="eyebrow">TU ESPACIO DE ORGANIZACIÓN</div>
            <h1>
              Las ideas empiezan
              <br />
              con una <em>pregunta.</em>
            </h1>
          </div>
          <span className="dashboard-mark">✳</span>
        </div>
        <section className="activity-list">
          <div className="section-header">
            <div>
              <span className="section-kicker">TU HISTORIAL</span>
              <h2>Conversaciones</h2>
            </div>
            <span className="activity-count">
              {String(activities.length).padStart(2, "0")}
            </span>
          </div>
          {activities.length ? (
            <div className="activity-grid">
              {activities.map((activity) => (
                <ActivityCard key={activity.id} activity={activity} />
              ))}
            </div>
          ) : (
            <div className="empty-activities">
              <span>✳</span>
              <p>
                Todavía no hay actividades. Abrí una conversación abajo para
                empezar.
              </p>
            </div>
          )}
        </section>
        <details
          className="dashboard-create-accordion"
          open={activities.length === 0}
        >
          <summary className="dashboard-create-summary">
            <div className="dashboard-create-summary-left">
              <span className="button button-primary create-toggle-button">
                + Nueva actividad
              </span>
              <span className="create-summary-hint">
                {activities.length === 0
                  ? "Completá el formulario para comenzar"
                  : "Abrí una nueva conversación y prepará el muro"}
              </span>
            </div>
            <span className="create-accordion-indicator" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div className="dashboard-create">
            <div className="create-intro">
              <span className="section-kicker">NUEVA ACTIVIDAD</span>
              <h2>Abrí una conversación.</h2>
              <p>
                Contá qué querés conversar. El muro queda abierto para recibir
                ideas.
              </p>
            </div>
            <ActivityForm />
          </div>
        </details>
      </section>
    </main>
  );
}
