"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitIdeaAction } from "@/app/actions";

export function IdeaForm({ code }: { code: string }) {
  const action = submitIdeaAction.bind(null, code);
  const [state, formAction, pending] = useActionState(action, {});
  const [participant, setParticipant] = useState({
    first_name: "",
    last_name: "",
    email: "",
  });
  const [content, setContent] = useState("");
  const [dismissedSuccess, setDismissedSuccess] = useState(false);
  const prevPendingRef = useRef(false);
  const successRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (prevPendingRef.current && !pending) {
      if (state.success) {
        setContent("");
        setDismissedSuccess(false);
        successRef.current?.focus();
        successRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      } else if (state.error) {
        errorRef.current?.focus();
        errorRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }
    }
    prevPendingRef.current = pending;
  }, [pending, state]);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();
        }
      }}
      className="stack-form idea-form"
    >
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
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setDismissedSuccess(true);
          }}
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
      {!pending && state.error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          className="form-message error-message idea-submission-status idea-submission-error"
          role="alert"
          aria-live="assertive"
        >
          <div className="status-badge-icon" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <circle
                cx="10"
                cy="10"
                r="9"
                stroke="currentColor"
                strokeWidth="1.75"
              />
              <path
                d="M10 6.5V11"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
              <circle cx="10" cy="14" r="1" fill="currentColor" />
            </svg>
          </div>
          <div className="status-message-content">
            <strong className="status-title">No pudimos enviar tu idea</strong>
            <p className="status-explanation">{state.error}</p>
          </div>
        </div>
      )}
      {!pending && state.success && !dismissedSuccess && (
        <div
          ref={successRef}
          tabIndex={-1}
          className="form-message success-message idea-submission-status idea-submission-success"
          role="status"
          aria-live="polite"
        >
          <div className="status-badge-icon" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <circle
                cx="10"
                cy="10"
                r="9"
                stroke="currentColor"
                strokeWidth="1.75"
              />
              <path
                d="M6 10.2L8.7 13L14 7"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="status-message-content">
            <strong className="status-title">¡Idea enviada!</strong>
            <p className="status-explanation">{state.success}</p>
          </div>
        </div>
      )}
      <button
        type="submit"
        className="button button-primary button-wide"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? (
          <>
            <span className="button-spinner" aria-hidden="true" />
            Enviando…
          </>
        ) : (
          <>
            Sumar mi idea
            <span aria-hidden="true">↗</span>
          </>
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {pending ? "Enviando tu idea…" : ""}
      </span>
    </form>
  );
}
