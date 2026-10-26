"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deleteActivityAction } from "@/app/actions";

interface DeleteActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  activityId: string;
  activityTitle: string;
}

export function DeleteActivityModal({
  isOpen,
  onClose,
  activityId,
  activityTitle,
}: DeleteActivityModalProps) {
  const [mounted, setMounted] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [state, formAction, pending] = useActionState(deleteActivityAction, {});

  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reiniciar estado de confirmación cuando se abre
  useEffect(() => {
    if (isOpen) {
      setIsConfirmed(false);
      // Foco inicial en cancelar (acción segura por defecto)
      const timer = setTimeout(() => {
        cancelButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Manejo de tecla Escape y bloqueo de scroll
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
      }

      // Trampa de foco
      if (event.key === "Tab" && dialogRef.current) {
        const focusableElements =
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, pending, onClose]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div className="delete-modal-backdrop">
      <div
        ref={dialogRef}
        className="delete-modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-desc"
      >
        <div className="delete-modal-header">
          <span className="delete-modal-badge" aria-hidden="true">
            ⚠
          </span>
          <div>
            <h2 id="delete-dialog-title" className="delete-modal-title">
              ¿Eliminar definitivamente la conversación?
            </h2>
            <p className="delete-modal-subtitle">
              Actividad: <strong>“{activityTitle}”</strong>
            </p>
          </div>
        </div>

        <div id="delete-dialog-desc" className="delete-modal-body">
          <p>
            Esta acción <strong>no se puede deshacer</strong>. Al eliminar esta
            actividad:
          </p>
          <ul className="delete-modal-list">
            <li>Se eliminarán todas las ideas recibidas y moderadas.</li>
            <li>Se perderán los registros de participantes vinculados.</li>
            <li>
              El enlace público y el código dejarán de funcionar de inmediato.
            </li>
          </ul>

          <label className="delete-modal-checkbox-label">
            <input
              type="checkbox"
              id="confirm-delete-checkbox"
              checked={isConfirmed}
              onChange={(e) => setIsConfirmed(e.target.checked)}
              disabled={pending}
            />
            <span>
              Entiendo las consecuencias y confirmo que deseo eliminar esta
              actividad de forma permanente.
            </span>
          </label>
        </div>

        {state.error && (
          <div className="delete-modal-error" role="alert">
            <p>{state.error}</p>
          </div>
        )}

        <div className="delete-modal-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="button button-quiet"
            onClick={onClose}
            disabled={pending}
          >
            Cancelar y volver
          </button>

          <form action={formAction}>
            <input type="hidden" name="activity_id" value={activityId} />
            <button
              type="submit"
              className="button button-danger delete-modal-confirm-btn"
              disabled={!isConfirmed || pending}
              aria-busy={pending}
            >
              {pending ? "Eliminando…" : "Eliminar definitivamente"}
            </button>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
