import Link from "next/link";
import type { Activity } from "@/lib/types";

export function ActivityCard({ activity }: { activity: Activity }) {
  return (
    <article className="activity-card">
      <div className="activity-card-top">
        <span className={`status-pill status-${activity.status}`}>
          {activity.status === "open"
            ? "En curso"
            : activity.status === "closed"
              ? "Cerrada"
              : "Borrador"}
        </span>
        <span className="activity-code">Código {activity.public_code}</span>
      </div>
      <Link
        className="activity-card-title-link"
        href={`/panel/actividad/${activity.id}`}
      >
        <h3>
          {activity.title}{" "}
          <span className="activity-arrow" aria-hidden="true">
            ↗
          </span>
        </h3>
      </Link>
      <p>{activity.question}</p>
      <div className="activity-card-bottom">
        <span className="activity-mode">
          {activity.moderation_mode === "automatic"
            ? "Publicación directa"
            : "Con aprobación"}
        </span>
        <Link
          className="activity-wall-link"
          href={`/muro/${activity.public_code}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Abrir muro público de ${activity.title} en nueva pestaña`}
        >
          Abrir muro ↗
        </Link>
      </div>
    </article>
  );
}
