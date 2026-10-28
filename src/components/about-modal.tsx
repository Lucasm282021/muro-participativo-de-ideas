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

        <div
          style={{
            borderTop: "1px solid #e7e5dc",
            margin: "6px 0 2px",
          }}
        />

        <div
          style={{
            fontWeight: 600,
            fontSize: "12px",
            color: "#2d342c",
            letterSpacing: "0.3px",
            textTransform: "uppercase",
            marginTop: "2px",
          }}
        >
          Contacto del desarrollador
        </div>

        {/* Correo electrónico */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, color: "#70766f" }}
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
          <a
            href="mailto:lucasdamianmontero@gmail.com"
            style={{
              color: "#2f5c35",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
              wordBreak: "break-all",
            }}
          >
            lucasdamianmontero@gmail.com
          </a>
        </div>

        {/* Instagram */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, color: "#70766f" }}
          >
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
          </svg>
          <a
            href="https://www.instagram.com/ldmontero28/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#2f5c35",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            }}
          >
            @ldmontero28
          </a>
        </div>

        {/* WhatsApp (Texto estricto sin enlace ni botón) */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, color: "#70766f" }}
          >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span>WhatsApp: 2284474721</span>
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
