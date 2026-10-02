"use client";

import { useActionState } from "react";
import { createActivityAction } from "@/app/actions";

export function ActivityForm() {
  const [state, formAction, pending] = useActionState(createActivityAction, {});

  return (
    <form action={formAction} className="stack-form activity-form">
      <label>
        Nombre de la actividad
        <input
          name="title"
          placeholder="Ej. Encuentro de equipo 2026"
          maxLength={120}
          required
        />
      </label>
      <label>
        Pregunta para abrir la conversación
        <textarea
          name="question"
          placeholder="¿Qué podríamos hacer para trabajar mejor juntos?"
          maxLength={300}
          rows={3}
          required
        />
      </label>
      <fieldset className="mode-fieldset">
        <legend>¿Cómo se publican las ideas?</legend>
        <label className="mode-option">
          <input
            type="radio"
            name="moderation_mode"
            value="automatic"
            defaultChecked
          />
          <span>
            <strong>En el momento</strong>
            <small>Las ideas aparecen directamente en el muro.</small>
          </span>
        </label>
        <label className="mode-option">
          <input type="radio" name="moderation_mode" value="approval" />
          <span>
            <strong>Con aprobación</strong>
            <small>Revisás cada idea antes de mostrarla.</small>
          </span>
        </label>
      </fieldset>
      {state.error && (
        <p className="form-message error-message" role="alert">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        className="button button-primary"
        disabled={pending}
      >
        {pending ? "Creando…" : "Crear actividad"}
        <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
