"use client";

import { useState } from "react";

type PasswordInputProps = {
  autoComplete: string;
  id?: string;
  name: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
};

export function PasswordInput({
  autoComplete,
  id,
  name,
  placeholder,
  minLength,
  maxLength,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="password-input-wrap">
      <input
        autoComplete={autoComplete}
        id={id}
        maxLength={maxLength}
        minLength={minLength}
        name={name}
        placeholder={placeholder}
        required
        type={visible ? "text" : "password"}
      />
      <button
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        className="password-visibility-toggle"
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        {visible ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a2 2 0 002.8 2.8" />
            <path d="M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.1 9.5 7-.4 1.2-1.2 2.5-2.4 3.7" />
            <path d="M6.2 6.2C4.2 7.5 3 9.5 2.5 12c1 2.9 4.5 7 9.5 7 1 0 2-.2 2.9-.5" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 12C3.5 9.1 7 5 12 5s8.5 4.1 9.5 7c-1 2.9-4.5 7-9.5 7s-8.5-4.1-9.5-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </span>
  );
}
