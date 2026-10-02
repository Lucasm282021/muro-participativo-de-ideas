import Link from "next/link";
import type { Activity } from "@/lib/types";

export function ActivityCard({ activity }: { activity: Activity }) {
  return (
    <Link className="activity-card" href={`/panel/actividad/${activity.id}`}>
      <div className="activity-card-top">
        <span className={`status-pill status-${activity.status}`}>
          {activity.status === "open"
            ? "En curso"
            : activity.status === "closed"
              ? "Cerrada"
              : "Borrador"}
        </span>
        <span className="activity-arrow">↗</span>
      </div>
      <h3>{activity.title}</h3>
      <p>{activity.question}</p>
      <div className="activity-card-bottom">
        <span>
          {activity.moderation_mode === "automatic"
            ? "Publicación directa"
            : "Con aprobación"}
        </span>
        <span>Código {activity.public_code}</span>
      </div>
    </Link>
  );
}
