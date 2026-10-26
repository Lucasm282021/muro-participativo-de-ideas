"use client";

import { useActionState } from "react";
import { moderateIdeaAction } from "@/app/actions";

interface IdeaModerationActionsProps {
  activityId: string;
  ideaId: string;
  ideaStatus: "pending" | "published" | "hidden";
  moderationMode: "automatic" | "approval";
}

export function IdeaModerationActions({
  activityId,
  ideaId,
  ideaStatus,
  moderationMode,
}: IdeaModerationActionsProps) {
  const [state, formAction, pending] = useActionState(moderateIdeaAction, {});

  return (
    <div className="idea-moderation-container">
      <div className="moderation-actions">
        {ideaStatus === "pending" && (
          <>
            <form action={formAction}>
              <input type="hidden" name="activity_id" value={activityId} />
              <input type="hidden" name="idea_id" value={ideaId} />
              <input type="hidden" name="status" value="published" />
              <button
                type="submit"
                className="button button-approve"
                disabled={pending}
                aria-busy={pending}
              >
                {pending
                  ? "Publicando…"
                  : moderationMode === "approval"
                    ? "Aprobar idea"
                    : "Publicar idea"}
              </button>
            </form>
            <form action={formAction}>
              <input type="hidden" name="activity_id" value={activityId} />
              <input type="hidden" name="idea_id" value={ideaId} />
              <input type="hidden" name="status" value="hidden" />
              <button
                type="submit"
                className="button button-quiet"
                disabled={pending}
                aria-busy={pending}
              >
                {pending ? "Ocultando…" : "Rechazar idea"}
              </button>
            </form>
          </>
        )}
        {ideaStatus === "hidden" && (
          <form action={formAction}>
            <input type="hidden" name="activity_id" value={activityId} />
            <input type="hidden" name="idea_id" value={ideaId} />
            <input type="hidden" name="status" value="published" />
            <button
              type="submit"
              className="button button-approve"
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? "Publicando…" : "Volver a mostrar en el muro"}
            </button>
          </form>
        )}
        {ideaStatus === "published" && (
          <form action={formAction}>
            <input type="hidden" name="activity_id" value={activityId} />
            <input type="hidden" name="idea_id" value={ideaId} />
            <input type="hidden" name="status" value="hidden" />
            <button
              type="submit"
              className="button button-quiet"
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? "Ocultando…" : "Ocultar del muro"}
            </button>
          </form>
        )}
      </div>
      {state.error && (
        <p
          className="form-message error-message"
          role="alert"
          style={{ marginTop: "6px", fontSize: "11px" }}
        >
          {state.error}
        </p>
      )}
    </div>
  );
}
