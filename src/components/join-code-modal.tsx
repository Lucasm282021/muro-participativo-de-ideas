"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface JoinCodeModalProps {
  triggerText?: string;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  isOpen?: boolean;
  onClose?: () => void;
}

export function JoinCodeModal({
  triggerText = "Tengo un código",
  triggerClassName = "button button-quiet button-small",
  triggerStyle,
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
}: JoinCodeModalProps) {
  const router = useRouter();
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  const isControlled = controlledIsOpen !== undefined;
  const isModalOpen = isControlled ? controlledIsOpen : internalIsOpen;

  useEffect(() => {
    setMounted(true);
  }, []);

  const openModal = useCallback(() => {
    lastActiveElementRef.current = document.activeElement as HTMLElement | null;
    setCode("");
    setError(null);
    setNavigating(false);
    if (!isControlled) {
      setInternalIsOpen(true);
    }
  }, [isControlled]);

  const closeModal = useCallback(() => {
    if (isControlled && controlledOnClose) {
      controlledOnClose();
    } else {
      setInternalIsOpen(false);
    }
  }, [isControlled, controlledOnClose]);

  // Manejo de scroll en body y foco inicial en el input
  useEffect(() => {
    if (!isModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, 40);

    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      lastActiveElementRef.current?.focus();
    };
  }, [isModalOpen]);

  // Manejo de teclado: Escape y Focus Trap
  useEffect(() => {
    if (!isModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusableSelectors = [
          "button:not([disabled])",
          "[href]",
          "input:not([disabled])",
          "select:not([disabled])",
          "textarea:not([disabled])",
          '[tabindex]:not([tabindex="-1"])',
        ].join(", ");

        const focusableElements = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(focusableSelectors),
        );

        if (focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isModalOpen, closeModal]);

  // Cierre al hacer clic fuera del diálogo
  useEffect(() => {
    if (!isModalOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        closeModal();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isModalOpen, closeModal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code
      .trim()
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();

    if (!clean) {
      setError("Por favor, ingresá el código de la actividad.");
      inputRef.current?.focus();
      return;
    }

    if (clean.length < 4 || clean.length > 16) {
      setError("El código debe tener entre 4 y 16 caracteres.");
      inputRef.current?.focus();
      return;
    }

    setError(null);
    setNavigating(true);
    closeModal();
    router.push(`/a/${clean}`);
  };

  const modalNode =
    isModalOpen && mounted
      ? createPortal(
          <div className="join-code-modal-backdrop">
            <div
              ref={dialogRef}
              className="join-code-modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="join-code-modal-title"
              aria-describedby="join-code-modal-desc"
              tabIndex={-1}
            >
              <button
                ref={closeButtonRef}
                type="button"
                className="join-code-modal-close-btn"
                onClick={closeModal}
                aria-label="Cerrar ventana"
              >
                ✕
              </button>

              <div className="eyebrow" id="join-code-modal-eyebrow">
                PARTICIPAR DE UNA ACTIVIDAD
              </div>
              <h2
                id="join-code-modal-title"
                style={{
                  margin: "12px 0 8px",
                  fontSize: "26px",
                  fontWeight: 500,
                  letterSpacing: "-1px",
                }}
              >
                Ingresá tu código
              </h2>
              <p
                id="join-code-modal-desc"
                style={{
                  margin: "4px 0 20px",
                  color: "var(--muted)",
                  fontSize: "14px",
                  lineHeight: "1.5",
                }}
              >
                Escribí el código que te compartieron o que ves en la pantalla
                del muro.
              </p>

              <form onSubmit={handleSubmit} className="stack-form" noValidate>
                <label
                  htmlFor="activity-code-input"
                  style={{ fontWeight: 600, fontSize: "13px" }}
                >
                  Código de actividad
                  <input
                    ref={inputRef}
                    id="activity-code-input"
                    name="activity-code"
                    type="text"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      if (error) setError(null);
                    }}
                    placeholder="Ej: W7K9Q2M4"
                    maxLength={16}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck="false"
                    autoComplete="off"
                    required
                    style={{
                      marginTop: "6px",
                      letterSpacing: "2.5px",
                      fontFamily: "monospace",
                      fontWeight: 700,
                      fontSize: "18px",
                      textAlign: "center",
                      textTransform: "uppercase",
                      padding: "12px 14px",
                    }}
                  />
                </label>

                {error && (
                  <p
                    className="form-message error-message"
                    role="alert"
                    style={{ margin: "4px 0 0", fontSize: "13px" }}
                  >
                    {error}
                  </p>
                )}

                <div
                  style={{
                    marginTop: "16px",
                    display: "flex",
                    gap: "10px",
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    type="button"
                    className="button button-quiet button-small"
                    onClick={closeModal}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="button button-primary button-small"
                    disabled={navigating}
                  >
                    {navigating ? "Ingresando…" : "Sumarme a la actividad ↗"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        style={triggerStyle}
        onClick={openModal}
        aria-haspopup="dialog"
        aria-expanded={isModalOpen}
      >
        {triggerText}
      </button>
      {modalNode}
    </>
  );
}
