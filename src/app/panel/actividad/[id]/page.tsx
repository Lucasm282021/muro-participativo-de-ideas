import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { DeleteActivityButton } from "@/components/delete-activity-button";
import { IdeaModerationActions } from "@/components/idea-moderation-actions";
import { ModerationModeForm } from "@/components/moderation-mode-form";
import { ShareQrPanel } from "@/components/share-qr-panel";
import { getBaseUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import type { Activity, Idea } from "@/lib/types";
import { PanelLiveRefresh } from "./panel-live-refresh";

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
    .eq("owner_id", user.id)
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
  const baseUrl = await getBaseUrl();
  const joinUrl = new URL(`/a/${activity.public_code}`, baseUrl).toString();

  return (
    <main className="dashboard-page">
      <PanelLiveRefresh activityId={id} />
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
                ? "PUBLICACIÓN AUTOMÁTICA"
                : "REVISIÓN ANTES DE PUBLICAR"}
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
            <DeleteActivityButton
              activityId={id}
              activityTitle={activity.title}
            />
          </div>
        </div>
        <div className="detail-workspace">
          <ShareQrPanel
            joinUrl={joinUrl}
            publicCode={activity.public_code}
            activityId={id}
            participantCount={participantCount ?? 0}
            ideaCount={ideas.length}
            isOpen={activity.status === "open"}
          />
          <section className="moderation-section">
            <div className="section-header">
              <div>
                <span className="section-kicker">REVISIÓN DE IDEAS</span>
                <h2>Ideas recibidas</h2>
              </div>
              <span className="pending-badge">{pendingCount} por revisar</span>
            </div>
            {ideas.length ? (
              <div className="moderation-list">
                {ideas.map((idea) => (
                  <article className="moderation-card" key={idea.id}>
                    <div className="moderation-card-content">
                      <span className={`idea-status status-${idea.status}`}>
                        {idea.status === "pending"
                          ? "Por revisar"
                          : idea.status === "published"
                            ? "En el muro"
                            : "Oculta del muro"}
                      </span>
                      <p>{idea.content}</p>
                      <time>
                        {new Intl.DateTimeFormat("es-AR", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(idea.created_at))}
                      </time>
                    </div>
                    <IdeaModerationActions
                      activityId={id}
                      ideaId={idea.id}
                      ideaStatus={
                        idea.status as "pending" | "published" | "hidden"
                      }
                      moderationMode={activity.moderation_mode}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-activities">
                <span>✳</span>
                <p>
                  Todavía no hay ideas. Cuando alguien envíe una, vas a verla
                  acá junto con su estado.
                </p>
              </div>
            )}
          </section>
          <section className="participants-section">
            <div className="section-header">
              <div>
                <span className="section-kicker">DATOS DE CONTACTO</span>
                <h2>Participantes</h2>
                <p className="detail-section-description">
                  Solo vos ves sus nombres y correos; las ideas aparecen sin
                  autor en el muro.
                </p>
              </div>
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
                <p>
                  Todavía no hay participantes. Sus nombres y correos aparecerán
                  acá cuando envíen una idea.
                </p>
              </div>
            )}
          </section>
          <ModerationModeForm
            activityId={id}
            initialMode={activity.moderation_mode}
          />
        </div>
      </section>
    </main>
  );
}
