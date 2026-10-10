"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getBaseUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; success?: string };

const credentialsSchema = z.object({
  email: z.email("Ingresá un email válido.").max(254),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres.")
    .max(72),
});

export async function signInAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error)
    return {
      error: "No pudimos iniciar sesión. Revisá el email y la contraseña.",
    };
  redirect("/panel");
}

export async function signUpAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);
  if (error) {
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return {
        error:
          "Se superó el límite temporal de envío de correos de confirmación. Aguardá unos minutos o contactá a administración.",
      };
    }
    if (error.code === "user_already_exists") {
      return {
        error: "Ya existe una cuenta con ese email. Probá iniciar sesión.",
      };
    }
    if (process.env.NODE_ENV === "development") {
      console.error("Supabase signup failed:", {
        code: error.code,
        status: error.status,
        message: error.message,
      });
      return {
        error: `Supabase rechazó el registro (${error.code ?? error.status ?? "error"}): ${error.message}`,
      };
    }
    return { error: "No se pudo crear la cuenta. Probá con otro email." };
  }
  if (!data.session)
    return {
      success: "Cuenta creada. Revisá tu email para confirmar el acceso.",
    };
  redirect("/panel");
}

export async function requestPasswordResetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .email("Ingresá un email válido.")
    .max(254)
    .safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto") ?? "https";
  const origin =
    headerStore.get("origin") ??
    (host ? `${proto}://${host}` : await getBaseUrl());
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: new URL(
      "/auth/callback?next=/restablecer-contrasena",
      origin,
    ).toString(),
  });

  if (error)
    return {
      error:
        "No pudimos enviar el enlace. Revisá la configuración de Auth e intentá de nuevo.",
    };

  return {
    success:
      "Si existe una cuenta con ese email, recibirás un enlace para cambiar la contraseña.",
  };
}

export async function updatePasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres.")
    .max(72)
    .safeParse(formData.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user)
    return {
      error: "El enlace venció o ya fue utilizado. Solicitá uno nuevo.",
    };

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error)
    return {
      error:
        "No pudimos cambiar la contraseña. Solicitá un enlace nuevo e intentá otra vez.",
    };

  revalidatePath("/", "layout");
  redirect("/ingresar?password-updated=1");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}

const activitySchema = z.object({
  title: z.string().trim().min(1, "Escribí un título.").max(120),
  question: z.string().trim().min(1, "Escribí la consigna.").max(300),
  moderation_mode: z.enum(["automatic", "approval"]),
});

function newPublicCode() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(
    { length: 8 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
}

export async function createActivityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = activitySchema.safeParse({
    title: formData.get("title"),
    question: formData.get("question"),
    moderation_mode: formData.get("moderation_mode"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/ingresar");

  const { data, error } = await supabase
    .from("activities")
    .insert({
      owner_id: user.id,
      public_code: newPublicCode(),
      title: parsed.data.title,
      question: parsed.data.question,
      status: "open",
      moderation_mode: parsed.data.moderation_mode,
      opened_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data)
    return { error: "No pudimos crear la actividad. Intentá de nuevo." };
  revalidatePath("/panel");
  redirect(`/panel/actividad/${data.id}`);
}

const ideaSchema = z.object({
  first_name: z.string().trim().min(1, "Ingresá tu nombre.").max(100),
  last_name: z.string().trim().min(1, "Ingresá tu apellido.").max(100),
  email: z.email("Ingresá un email válido.").max(254),
  content: z
    .string()
    .trim()
    .min(1, "Escribí una idea.")
    .max(500, "La idea no puede superar los 500 caracteres."),
});

export async function submitIdeaAction(
  publicCode: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = ideaSchema.safeParse({
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    email: formData.get("email"),
    content: formData.get("content"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_idea", {
    activity_code: publicCode,
    participant_first_name: parsed.data.first_name,
    participant_last_name: parsed.data.last_name,
    participant_email: parsed.data.email,
    idea_content: parsed.data.content,
  });
  if (error || !data?.length)
    return {
      error:
        "La actividad ya no recibe ideas o hubo un problema. Volvé a intentarlo.",
    };
  return {
    success:
      data[0].idea_status === "published"
        ? "¡Tu idea ya está en el muro!"
        : "¡Gracias! Tu idea quedó pendiente de aprobación.",
  };
}

export async function moderateIdeaAction(formData: FormData) {
  const ideaId = z.uuid().safeParse(formData.get("idea_id"));
  const activityId = z.uuid().safeParse(formData.get("activity_id"));
  const status = z
    .enum(["published", "hidden"])
    .safeParse(formData.get("status"));
  if (!ideaId.success || !activityId.success || !status.success) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/ingresar");

  await supabase
    .from("ideas")
    .update({ status: status.data })
    .eq("id", ideaId.data)
    .eq("activity_id", activityId.data);
  revalidatePath(`/panel/actividad/${activityId.data}`);
}

export async function setModerationModeAction(formData: FormData) {
  const activityId = z.uuid().safeParse(formData.get("activity_id"));
  const mode = z
    .enum(["automatic", "approval"])
    .safeParse(formData.get("moderation_mode"));
  if (!activityId.success || !mode.success) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/ingresar");

  await supabase
    .from("activities")
    .update({ moderation_mode: mode.data })
    .eq("id", activityId.data);
  revalidatePath(`/panel/actividad/${activityId.data}`);
}

export async function toggleActivityAction(formData: FormData) {
  const activityId = z.uuid().safeParse(formData.get("activity_id"));
  const status = z.enum(["open", "closed"]).safeParse(formData.get("status"));
  if (!activityId.success || !status.success) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/ingresar");

  await supabase
    .from("activities")
    .update({
      status: status.data,
      closed_at: status.data === "closed" ? new Date().toISOString() : null,
      opened_at: status.data === "open" ? new Date().toISOString() : undefined,
    })
    .eq("id", activityId.data);
  revalidatePath("/panel");
  revalidatePath(`/panel/actividad/${activityId.data}`);
}

export async function deleteActivityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const activityId = z.uuid().safeParse(formData.get("activity_id"));
  if (!activityId.success)
    return { error: "La actividad seleccionada no es válida." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/ingresar");

  const { data, error } = await supabase
    .from("activities")
    .delete()
    .eq("id", activityId.data)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle();

  if (error || !data)
    return {
      error:
        "No pudimos eliminar la charla. Actualizá la página e intentá de nuevo.",
    };

  revalidatePath("/panel");
  redirect("/panel");
}
