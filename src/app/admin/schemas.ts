import { z } from "zod";

export const adminModerateIdeaSchema = z.object({
  ideaId: z.string().uuid("Identificador de idea inválido."),
  status: z.enum(["published", "hidden"], {
    message: "Estado de moderación inválido.",
  }),
});

export const adminToggleActivitySchema = z.object({
  activityId: z.string().uuid("Identificador de actividad inválido."),
  status: z.enum(["open", "closed"], {
    message: "Estado de actividad inválido.",
  }),
});

export const adminDeleteActivitySchema = z.object({
  activityId: z.string().uuid("Identificador de actividad inválido."),
  confirmationCode: z
    .string()
    .trim()
    .length(
      8,
      "El código de confirmación debe tener exactamente 8 caracteres.",
    ),
});

export const adminDeleteIdeaSchema = z.object({
  ideaId: z.string().uuid("Identificador de idea inválido."),
});
