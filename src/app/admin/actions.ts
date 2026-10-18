"use server";

import { revalidatePath } from "next/cache";
import { checkAdminAuthorization } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import {
  adminDeleteActivitySchema,
  adminDeleteIdeaSchema,
  adminModerateIdeaSchema,
  adminToggleActivitySchema,
} from "./schemas";

export type FormState = { error?: string; success?: string };

/**
 * Server Action para moderación global de ideas (publicar u ocultar).
 * Valida rol en servidor, existencia de la idea e idempotencia de estado.
 */
export async function adminModerateIdeaAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = adminModerateIdeaSchema.safeParse({
    ideaId: formData.get("idea_id"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const auth = await checkAdminAuthorization(supabase);
  if (!auth.authorized) {
    return { error: auth.error };
  }

  // 1. Obtener idea para validar existencia y actividad asociada
  const { data: idea, error: fetchError } = await supabase
    .from("ideas")
    .select("id, status, activity_id")
    .eq("id", parsed.data.ideaId)
    .maybeSingle();

  if (fetchError || !idea) {
    return {
      error: "Idea no encontrada o no accesible en el contexto actual.",
    };
  }

  // 2. Idempotencia: si ya tiene el estado solicitado, no realizar operación redundante
  if (idea.status === parsed.data.status) {
    return {
      success: "La idea ya se encuentra en el estado solicitado.",
    };
  }

  // 3. Mutación de estado (la columna published_at es gestionada por el trigger ideas_update_published_at)
  const { error: updateError } = await supabase
    .from("ideas")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.ideaId);

  if (updateError) {
    return {
      error: `Error al actualizar la idea: ${updateError.message}`,
    };
  }

  revalidatePath("/admin");
  if (idea.activity_id) {
    revalidatePath(`/panel/actividad/${idea.activity_id}`);
  }

  return {
    success: `Idea ${parsed.data.status === "published" ? "publicada" : "ocultada"} exitosamente.`,
  };
}

/**
 * Server Action para cierre y reapertura global de actividades.
 * Valida rol en servidor, existencia de la actividad y sincroniza marcas temporales.
 */
export async function adminToggleActivityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = adminToggleActivitySchema.safeParse({
    activityId: formData.get("activity_id"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const auth = await checkAdminAuthorization(supabase);
  if (!auth.authorized) {
    return { error: auth.error };
  }

  // 1. Validar existencia y estado actual
  const { data: activity, error: fetchError } = await supabase
    .from("activities")
    .select("id, status")
    .eq("id", parsed.data.activityId)
    .maybeSingle();

  if (fetchError || !activity) {
    return { error: "Actividad no encontrada o no accesible." };
  }

  if (activity.status === parsed.data.status) {
    return {
      success: "La actividad ya se encuentra en el estado solicitado.",
    };
  }

  // 2. Aplicar cambio de estado y marcas temporales
  const { error: updateError } = await supabase
    .from("activities")
    .update({
      status: parsed.data.status,
      closed_at:
        parsed.data.status === "closed" ? new Date().toISOString() : null,
      opened_at:
        parsed.data.status === "open" ? new Date().toISOString() : undefined,
    })
    .eq("id", parsed.data.activityId);

  if (updateError) {
    return {
      error: `Error al actualizar la actividad: ${updateError.message}`,
    };
  }

  revalidatePath("/admin");
  revalidatePath(`/panel/actividad/${parsed.data.activityId}`);

  return {
    success: `Actividad ${parsed.data.status === "open" ? "reabierta" : "cerrada"} exitosamente.`,
  };
}

/**
 * Server Action para eliminación administrativa de actividades.
 * Exige autorización administrativa Y verificación del código público como doble barrera.
 */
export async function adminDeleteActivityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = adminDeleteActivitySchema.safeParse({
    activityId: formData.get("activity_id"),
    confirmationCode: formData.get("confirmation_code"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const auth = await checkAdminAuthorization(supabase);
  if (!auth.authorized) {
    return { error: auth.error };
  }

  // 1. Validar existencia y código público
  const { data: activity, error: fetchError } = await supabase
    .from("activities")
    .select("id, public_code, title")
    .eq("id", parsed.data.activityId)
    .maybeSingle();

  if (fetchError || !activity) {
    return { error: "Actividad no encontrada o no accesible." };
  }

  // 2. Comprobación estricta de código público como barrera contra accidentes
  if (
    activity.public_code.toUpperCase() !==
    parsed.data.confirmationCode.toUpperCase()
  ) {
    return {
      error:
        "El código ingresado no coincide con el código público de la actividad.",
    };
  }

  // 3. Ejecutar borrado relacional (las claves foráneas en BD propagan la cascada sobre ideas, participantes y autores)
  const { error: deleteError } = await supabase
    .from("activities")
    .delete()
    .eq("id", parsed.data.activityId);

  if (deleteError) {
    return {
      error: `Error al eliminar la actividad: ${deleteError.message}`,
    };
  }

  revalidatePath("/admin");
  return {
    success: `Actividad "${activity.title}" (${activity.public_code}) eliminada exitosamente.`,
  };
}

/**
 * Server Action para eliminación administrativa individual de una idea.
 * Valida autorización administrativa en servidor, existencia previa y confirma el resultado exacto.
 */
export async function adminDeleteIdeaAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = adminDeleteIdeaSchema.safeParse({
    ideaId: formData.get("idea_id"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const auth = await checkAdminAuthorization(supabase);
  if (!auth.authorized) {
    return { error: auth.error };
  }

  // 1. Validar existencia y actividad vinculada para posterior revalidación
  const { data: idea, error: fetchError } = await supabase
    .from("ideas")
    .select("id, activity_id")
    .eq("id", parsed.data.ideaId)
    .maybeSingle();

  if (fetchError || !idea) {
    return {
      error: "Idea no encontrada o no accesible en el contexto actual.",
    };
  }

  // 2. Ejecutar borrado individual comprobando filas afectadas devueltas
  const { data: deletedRows, error: deleteError } = await supabase
    .from("ideas")
    .delete()
    .eq("id", parsed.data.ideaId)
    .select("id");

  if (deleteError) {
    return {
      error: `Error al eliminar la idea: ${deleteError.message}`,
    };
  }

  if (
    !deletedRows ||
    deletedRows.length === 0 ||
    deletedRows[0].id !== parsed.data.ideaId
  ) {
    return {
      error: "No se pudo eliminar la idea o la operación no tuvo efecto.",
    };
  }

  // 3. Revalidar rutas pertinentes tras confirmación del resultado
  revalidatePath("/admin");
  if (idea.activity_id) {
    revalidatePath(`/panel/actividad/${idea.activity_id}`);
  }

  return {
    success: "Idea eliminada exitosamente.",
  };
}
