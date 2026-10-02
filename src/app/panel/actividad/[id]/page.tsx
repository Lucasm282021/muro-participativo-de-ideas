import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  moderateIdeaAction,
  setModerationModeAction,
  signOutAction,
  toggleActivityAction,
} from "@/app/actions";
import { createClient } from "@/lib/supabase/server";
import type { Activity, Idea } from "@/lib/types";

export default async function ActivityDetailPage({
  params,
}: PageProps<"/panel/actividad/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/ingresar");

  const { data: rawActivity } = await supabase
    .from("activities")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!rawActivity) notFound();
  const activity = rawActivity as Activity;
  const [
    { data: rawIdeas },
    { data: participants },
    { count: participantCount },
  ] = await Promise.all([
    supabase
      .from("ideas")
      .select("*")
      .eq("activity_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("participants")
      .select("first_name, last_name, email, created_at")
      .eq("activity_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("participants")
      .select("id", { count: "exact", head: true })
      .eq("activity_id", id),
  ]);
  const ideas = (rawIdeas ?? []) as Idea[];
  const pendingCount = ideas.filter((idea) => idea.status === "pending").length;

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
          <Link className="nav-signin" href="/panel">
            ← Actividades
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="nav-signin">
              Salir
            </button>
          </form>
        </div>
      </header>
      <section className="detail-main">
        <div className="detail-back">
          <Link href="/panel">← Todas las conversaciones</Link>
          <span className={`status-pill status-${activity.status}`}>
            {activity.status === "open" ? "En curso" : "Cerrada"}
          </span>
        </div>
        <div className="detail-heading">
          <div>
            <div className="eyebrow">
              CÓDIGO {activity.public_code} ·{" "}
              {activity.moderation_mode === "automatic"
                ? "PUBLICACIÓN DIRECTA"
                : "CON APROBACIÓN"}
            </div>
            <h1>{activity.title}</h1>
            <p>{activity.question}</p>
          </div>
          <div className="detail-actions">
            <Link
              className="button button-quiet"
              href={`/a/${activity.public_code}`}
              target="_blank"
            >
              Ver formulario ↗
            </Link>
            <Link
              className="button button-primary"
              href={`/muro/${activity.public_code}`}
              target="_blank"
            >
              Abrir muro ↗
            </Link>
          </div>
        </div>
        <form action={setModerationModeAction} className="mode-change-strip">
          <input type="hidden" name="activity_id" value={id} />
          <div>
            <span className="section-kicker">MODO DE PUBLICACIÓN</span>
            <p>
              Podés cambiarlo durante la actividad. Las ideas pendientes siguen
              esperando revisión.
            </p>
          </div>
          <select
            name="moderation_mode"
            defaultValue={activity.moderation_mode}
            aria-label="Modo de publicación"
          >
            <option value="automatic">Publicación directa</option>
            <option value="approval">Con aprobación</option>
          </select>
          <button type="submit" className="button button-quiet">
            Guardar
          </button>
        </form>
        <div className="share-strip">
          <div>
            <span>ENLACE PARA PARTICIPAR</span>
            <strong>{`/a/${activity.public_code}`}</strong>
          </div>
          <div>
            <span>PARTICIPANTES</span>
            <strong>{participantCount ?? 0}</strong>
          </div>
          <div>
            <span>IDEAS</span>
            <strong>{ideas.length}</strong>
          </div>
          <form action={toggleActivityAction}>
            <input type="hidden" name="activity_id" value={id} />
            <input
              type="hidden"
              name="status"
              value={activity.status === "open" ? "closed" : "open"}
            />
            <button
              type="submit"
              className={
                activity.status === "open"
                  ? "button button-danger"
                  : "button button-primary"
              }
            >
              {activity.status === "open"
                ? "Cerrar actividad"
                : "Reabrir actividad"}
            </button>
          </form>
        </div>
        <section className="participants-section">
          <div className="section-header">
            <div>
              <span className="section-kicker">SOLO VISIBLE PARA VOS</span>
              <h2>Participantes</h2>
            </div>
            <span className="activity-count">
              {String(participantCount ?? 0).padStart(2, "0")}
            </span>
          </div>
          {participants?.length ? (
            <div className="participants-list">
              {participants.map((participant) => (
                <article className="participant-row" key={participant.email}>
                  <span className="participant-avatar">
                    {participant.first_name.slice(0, 1)}
                    {participant.last_name.slice(0, 1)}
                  </span>
                  <strong>
                    {participant.first_name} {participant.last_name}
                  </strong>
                  <span>{participant.email}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-activities">
              <span>◌</span>
              <p>Los nombres y emails aparecerán cuando alguien participe.</p>
            </div>
          )}
        </section>
        <section className="moderation-section">
          <div className="section-header">
            <div>
              <span className="section-kicker">MODERACIÓN</span>
              <h2>Ideas recibidas</h2>
            </div>
            <span className="pending-badge">{pendingCount} pendientes</span>
          </div>
          {ideas.length ? (
            <div className="moderation-list">
              {ideas.map((idea) => (
                <article className="moderation-card" key={idea.id}>
                  <div className="moderation-card-content">
                    <span className={`idea-status status-${idea.status}`}>
                      {idea.status === "pending"
                        ? "Pendiente"
                        : idea.status === "published"
                          ? "Publicada"
                          : "Oculta"}
                    </span>
                    <p>{idea.content}</p>
                    <time>
                      {new Intl.DateTimeFormat("es-AR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(idea.created_at))}
                    </time>
                  </div>
                  {activity.moderation_mode === "approval" && (
                    <div className="moderation-actions">
                      {idea.status !== "published" && (
                        <form action={moderateIdeaAction}>
                          <input type="hidden" name="activity_id" value={id} />
                          <input type="hidden" name="idea_id" value={idea.id} />
                          <input
                            type="hidden"
                            name="status"
                            value="published"
                          />
                          <button
                            type="submit"
                            className="button button-approve"
                          >
                            Publicar
                          </button>
                        </form>
                      )}
                      {idea.status !== "hidden" && (
                        <form action={moderateIdeaAction}>
                          <input type="hidden" name="activity_id" value={id} />
                          <input type="hidden" name="idea_id" value={idea.id} />
                          <input type="hidden" name="status" value="hidden" />
                          <button type="submit" className="button button-quiet">
                            Ocultar
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-activities">
              <span>✳</span>
              <p>Las primeras ideas van a aparecer acá.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
