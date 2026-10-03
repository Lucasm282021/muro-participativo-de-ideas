"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, signUpAction } from "@/app/actions";
import { PasswordInput } from "@/components/password-input";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const isSignUp = mode === "sign-up";
  const [state, formAction, pending] = useActionState(
    isSignUp ? signUpAction : signInAction,
    {},
  );

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
        <h1>{isSignUp ? "Creá tu espacio" : "Qué bueno verte"}</h1>
        <p>
          {isSignUp
            ? "Armá una actividad y abrí la conversación."
            : "Ingresá para continuar con tus actividades."}
        </p>
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
          <label>
            Contraseña
            <PasswordInput
              autoComplete={isSignUp ? "new-password" : "current-password"}
              name="password"
              placeholder="Al menos 8 caracteres"
              minLength={8}
            />
          </label>
          {!isSignUp && (
            <div className="auth-switch">
              <Link href="/recuperar-contrasena">¿Olvidaste tu contraseña?</Link>
            </div>
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
            {pending ? "Un momento…" : isSignUp ? "Crear cuenta" : "Ingresar"}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
        <div className="auth-switch">
          {isSignUp ? "¿Ya tenés una cuenta?" : "¿Todavía no tenés cuenta?"}{" "}
          <Link href={isSignUp ? "/ingresar" : "/crear-cuenta"}>
            {isSignUp ? "Ingresá" : "Creá una"}
          </Link>
        </div>
      </section>
      <p className="auth-footer">
        Hecho para que las buenas ideas encuentren lugar.
      </p>
    </main>
  );
}
