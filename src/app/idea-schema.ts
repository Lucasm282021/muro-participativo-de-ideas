import { z } from "zod";

export const ideaSchema = z.object({
  first_name: z.string().trim().min(1, "Ingresá tu nombre.").max(100),
  last_name: z.string().trim().min(1, "Ingresá tu apellido.").max(100),
  email: z.email("Ingresá un email válido.").max(254),
  content: z
    .string()
    .trim()
    .min(1, "Escribí una idea.")
    .max(500, "La idea no puede superar los 500 caracteres."),
});

export type IdeaInput = z.infer<typeof ideaSchema>;

export type SubmitIdeaRow = {
  outcome?: string | null;
  idea_id?: string | null;
  idea_status?: string | null;
};

export type SubmitIdeaOutcomeResult = {
  error?: string;
  success?: string;
  revalidate?: boolean;
};

/**
 * Función pura que resuelve la respuesta de submitIdeaAction a partir de la salida de la RPC.
 * Mantiene compatibilidad dual:
 * 1. Contrato vigente (A2): con columna 'outcome' ('accepted', 'duplicate', 'rate_limited').
 * 2. Contrato legacy: sin columna 'outcome', identificando éxito por presencia de 'idea_id' e 'idea_status'.
 */
export function resolveSubmitIdeaOutcome(
  data: SubmitIdeaRow[] | null | undefined,
  error: unknown,
): SubmitIdeaOutcomeResult {
  if (error || !data?.length) {
    return {
      error:
        "La actividad ya no recibe ideas o hubo un problema. Volvé a intentarlo.",
    };
  }

  const result = data[0];
  if (result.outcome === "duplicate") {
    return {
      error:
        "Ya enviaste una idea igual en esta actividad. Probá con una idea distinta.",
    };
  }
  if (result.outcome === "rate_limited") {
    return {
      error:
        "Enviaste varias ideas seguidas. Esperá un minuto antes de sumar otra.",
    };
  }

  const isAccepted =
    result.outcome === "accepted" ||
    (!result.outcome && Boolean(result.idea_id && result.idea_status));

  return {
    revalidate: isAccepted,
    success:
      result.idea_status === "published"
        ? "¡Tu idea ya está en el muro!"
        : "¡Gracias! Tu idea quedó pendiente de aprobación.",
  };
}
