"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useActionState } from "react";
import {
  requestPasswordResetAction,
  updatePasswordAction,
} from "@/app/actions";
import { PasswordInput } from "@/components/password-input";

function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-layout">
      <Link className="brand brand-dark" href="/">
        <span className="brand-mark">
          m<span>.</span>
        </span>
        <span>
          muro<span className="brand-light">común</span>
        </span>
      </Link>
      <section className="auth-card">
        <div className="eyebrow">ESPACIO DE ORGANIZACIÓN</div>
        <h1>{title}</h1>
        <p>{description}</p>
        {children}
        <div className="auth-switch">
          <Link href="/ingresar">Volver a ingresar</Link>
        </div>
      </section>
      <p className="auth-footer">
        Hecho para que las buenas ideas encuentren lugar.
      </p>
    </main>
  );
}

export function RequestPasswordResetForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    {},
  );

  return (
    <AuthShell
      title="Recuperá tu contraseña"
      description="Te enviaremos un enlace para elegir una contraseña nueva."
    >
      <form action={formAction} className="stack-form">
        <label>
          Email
          <input
            autoComplete="email"
            name="email"
            type="email"
            placeholder="vos@organizacion.com"
            required
          />
        </label>
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
          {pending ? "Enviando…" : "Enviar enlace"}
          <span aria-hidden="true">↗</span>
        </button>
      </form>
    </AuthShell>
  );
}

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, {});

  return (
    <AuthShell
      title="Elegí una contraseña nueva"
      description="Usá al menos 8 caracteres para proteger tu cuenta."
    >
      <form action={formAction} className="stack-form">
        <label>
          Nueva contraseña
          <PasswordInput
            autoComplete="new-password"
            name="password"
            minLength={8}
            maxLength={72}
          />
        </label>
        {state.error && (
          <p className="form-message error-message" role="alert">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          className="button button-primary button-wide"
          disabled={pending}
        >
          {pending ? "Guardando…" : "Cambiar contraseña"}
          <span aria-hidden="true">↗</span>
        </button>
      </form>
    </AuthShell>
  );
}
