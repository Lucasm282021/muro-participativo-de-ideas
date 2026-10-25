"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import pkg from "../../package.json";

export function AboutContent() {
  return (
    <>
      <div className="eyebrow" id="about-modal-eyebrow">
        INFORMACIÓN INSTITUCIONAL
      </div>
      <h1
        id="about-modal-title"
        style={{
          margin: "14px 0 8px",
          fontSize: "28px",
          fontWeight: 500,
          letterSpacing: "-1.2px",
        }}
      >
        Muro Participativo de Ideas
      </h1>
      <p
        id="about-modal-desc"
        style={{
          margin: "8px 0 0",
          color: "#70766f",
          fontSize: "14px",
          lineHeight: "1.6",
        }}
      >
        Plataforma colaborativa para abrir conversaciones, proyectar ideas y
        escucharnos en tiempo real durante actividades y encuentros colectivos.
      </p>

      <div
        style={{
          margin: "20px 0",
          padding: "16px",
          background: "#f7f6f0",
          border: "1px solid #e7e5dc",
          borderRadius: "6px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          fontSize: "13px",
          color: "#414a3e",
        }}
      >
        <div>
          <strong>Desarrollado por Lucas Damián Montero</strong>
        </div>
        <div>
          <strong>Versión del código:</strong> v{pkg.version}
        </div>
      </div>
    </>
  );
}

interface AboutModalProps {
  triggerText?: string;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  isOpen?: boolean;
  onClose?: () => void;
}

export function AboutModal({
  triggerText = "Acerca de",
  triggerClassName,
  triggerStyle,
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
}: AboutModalProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  const isControlled = controlledIsOpen !== undefined;
  const isModalOpen = isControlled ? controlledIsOpen : internalIsOpen;

  useEffect(() => {
    setMounted(true);
  }, []);

  const openModal = useCallback(() => {
    lastActiveElementRef.current = document.activeElement as HTMLElement | null;
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

  // Manejo de scroll en body y foco inicial
  useEffect(() => {
    if (!isModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 20);

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

  const modalNode =
    isModalOpen && mounted
      ? createPortal(
          <div className="about-modal-backdrop">
            <div
              ref={dialogRef}
              className="about-modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="about-modal-title"
              aria-describedby="about-modal-desc"
              tabIndex={-1}
            >
              <button
                ref={closeButtonRef}
                type="button"
                className="about-modal-close-btn"
                onClick={closeModal}
                aria-label="Cerrar ventana"
              >
                ✕
              </button>

              <AboutContent />

              <div
                style={{
                  marginTop: "20px",
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  className="button button-primary button-small"
                  onClick={closeModal}
                >
                  Cerrar
                </button>
              </div>
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
