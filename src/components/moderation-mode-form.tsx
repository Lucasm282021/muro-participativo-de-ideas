"use client";

import { useActionState, useEffect, useState } from "react";
import { setModerationModeAction } from "@/app/actions";

interface ModerationModeFormProps {
  activityId: string;
  initialMode: "automatic" | "approval";
}

export function ModerationModeForm({
  activityId,
  initialMode,
}: ModerationModeFormProps) {
  const [state, formAction, pending] = useActionState(
    setModerationModeAction,
    {},
  );
  const [mode, setMode] = useState(initialMode);

  // Sincronizar con el modo proveniente del servidor
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Si falló el guardado en servidor, revertir la selección visual para evitar sugerir falso éxito
  useEffect(() => {
    if (state.error) {
      setMode(initialMode);
    }
  }, [state.error, initialMode]);

  return (
    <form action={formAction} className="mode-change-strip">
      <input type="hidden" name="activity_id" value={activityId} />
      <div className="mode-change-intro">
        <span className="section-kicker">PUBLICACIÓN DE IDEAS</span>
        <p>
          Elegí si las ideas nuevas se publican automáticamente o esperan tu
          aprobación. Las que ya están pendientes no cambian al guardar.
        </p>
      </div>
      <div className="mode-change-controls">
        <select
          name="moderation_mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as "automatic" | "approval")}
          disabled={pending}
          aria-label="Modo de publicación"
        >
          <option value="automatic">Publicar automáticamente</option>
          <option value="approval">Revisar antes de publicar</option>
        </select>
        <button
          type="submit"
          className="button button-quiet"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Guardando…" : "Guardar modo"}
        </button>
      </div>
      {state.error && (
        <p className="form-message error-message" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="form-message success-message" role="status">
          {state.success}
        </p>
      )}
    </form>
  );
}
