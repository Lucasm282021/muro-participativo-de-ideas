"use client";

import { useActionState } from "react";
import { deleteActivityAction } from "@/app/actions";

export function DeleteActivityButton({
  activityId,
  activityTitle,
}: {
  activityId: string;
  activityTitle: string;
}) {
  const [state, formAction, pending] = useActionState(deleteActivityAction, {});

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `¿Eliminar la charla “${activityTitle}”? Se borrarán también sus ideas y participantes. Esta acción no se puede deshacer.`,
        );
        if (!confirmed) event.preventDefault();
      }}
    >
      <input type="hidden" name="activity_id" value={activityId} />
      <button
        type="submit"
        className="button button-danger"
        disabled={pending}
      >
        {pending ? "Eliminando…" : "Eliminar charla"}
      </button>
      {state.error && (
        <p className="form-message error-message" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
