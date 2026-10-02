"use client";

import { useActionState, useEffect, useState } from "react";
import { submitIdeaAction } from "@/app/actions";

export function IdeaForm({ code }: { code: string }) {
  const action = submitIdeaAction.bind(null, code);
  const [state, formAction, pending] = useActionState(action, {});
  const [participant, setParticipant] = useState({
    first_name: "",
    last_name: "",
    email: "",
  });

  function clearSavedParticipant() {
    setParticipant({ first_name: "", last_name: "", email: "" });
    try {
      localStorage.removeItem(`muro-comun:participant:${code}`);
    } catch {
      // The inputs are cleared even if this browser blocks local storage.
    }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`muro-comun:participant:${code}`);
      if (saved) {
        const details = JSON.parse(saved);
        if (
          typeof details.first_name === "string" &&
          typeof details.last_name === "string" &&
          typeof details.email === "string"
        ) {
          setParticipant(details);
        }
      }
    } catch {
      // Participation still works if this browser blocks local storage.
    }
  }, [code]);

  useEffect(() => {
    if (!state.success || !participant.email) return;
    try {
      localStorage.setItem(
        `muro-comun:participant:${code}`,
        JSON.stringify(participant),
      );
    } catch {
      // The server already accepted the idea; remembering the details is optional.
    }
  }, [code, participant, state.success]);

  return (
    <form action={formAction} className="stack-form idea-form">
      <div className="participant-fields">
        <label>
          Nombre
          <input
            name="first_name"
            autoComplete="given-name"
            placeholder="Tu nombre"
            maxLength={100}
            value={participant.first_name}
            onChange={(event) =>
              setParticipant({ ...participant, first_name: event.target.value })
            }
            required
          />
        </label>
        <label>
          Apellido
          <input
            name="last_name"
            autoComplete="family-name"
            placeholder="Tu apellido"
            maxLength={100}
            value={participant.last_name}
            onChange={(event) =>
              setParticipant({ ...participant, last_name: event.target.value })
            }
            required
          />
        </label>
      </div>
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="vos@ejemplo.com"
          maxLength={254}
          value={participant.email}
          onChange={(event) =>
            setParticipant({ ...participant, email: event.target.value })
          }
          required
        />
      </label>
      <label>
        Tu idea
        <textarea
          name="content"
          placeholder="No hace falta que esté perfecta. Empezá por lo que te gustaría cambiar, probar o construir…"
          maxLength={500}
          rows={5}
          required
        />
      </label>
      <div className="form-hint">
        <span>Tu nombre y email solo los ve quien organiza.</span>
        <span>Máximo 500 caracteres</span>
      </div>
      <p className="participant-memory-note">
        Después del primer envío, recordamos tus datos en este dispositivo para
        que puedas sumar más ideas sin volver a completarlos.
      </p>
      {participant.email && (
        <button
          type="button"
          className="forget-data-button"
          onClick={clearSavedParticipant}
        >
          Borrar mis datos guardados de este dispositivo
        </button>
      )}
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
      <button
        type="submit"
        className="button button-primary button-wide"
        disabled={pending}
      >
        {pending ? "Enviando…" : "Sumar mi idea"}
        <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
