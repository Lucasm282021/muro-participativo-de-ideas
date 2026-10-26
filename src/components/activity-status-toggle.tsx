"use client";

import { useActionState } from "react";
import { toggleActivityAction } from "@/app/actions";

type ActivityStatusToggleProps = {
  activityId: string;
  isOpen: boolean;
};

export function ActivityStatusToggle({
  activityId,
  isOpen,
}: ActivityStatusToggleProps) {
  const [toggleState, toggleFormAction, isTogglePending] = useActionState(
    toggleActivityAction,
    {},
  );

  return (
    <div className="activity-status-toggle-wrapper">
      <form action={toggleFormAction} className="activity-status-form">
        <input type="hidden" name="activity_id" value={activityId} />
        <input type="hidden" name="status" value={isOpen ? "closed" : "open"} />
        <button
          type="submit"
          className={`status-toggle-button ${
            isOpen ? "toggle-close" : "toggle-open"
          }`}
          disabled={isTogglePending}
          aria-busy={isTogglePending}
        >
          {isTogglePending
            ? isOpen
              ? "Cerrando recepción…"
              : "Abriendo recepción…"
            : isOpen
              ? "Cerrar recepción de ideas"
              : "Reabrir recepción de ideas"}
        </button>
      </form>
      {toggleState.error && (
        <p
          className="form-message error-message status-toggle-message"
          role="alert"
        >
          {toggleState.error}
        </p>
      )}
      {toggleState.success && (
        <p
          className="form-message success-message status-toggle-message"
          role="status"
        >
          {toggleState.success}
        </p>
      )}
    </div>
  );
}
