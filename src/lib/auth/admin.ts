import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AdminAuthResult =
  | { authorized: true; user: User }
  | { authorized: false; error: string };

/**
 * Verifica la identidad y el rol administrativo en el servidor mediante consulta fresca.
 * No asume privilegios basados en datos de cliente ni en claims estáticos de JWT.
 * Utiliza exclusivamente el cliente Supabase del contexto de usuario autenticado.
 */
export async function checkAdminAuthorization(
  supabase: SupabaseClient,
): Promise<AdminAuthResult> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      authorized: false,
      error: "No se identificó una sesión activa en el servidor.",
    };
  }

  // Consulta autoritativa fresca a la función SQL is_admin()
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");

  if (roleError) {
    // Si la función SQL aún no existe o hay un fallo de comunicación, denegar por defecto (fail-closed)
    return {
      authorized: false,
      error:
        "No fue posible verificar el rol administrativo en la base de datos.",
    };
  }

  if (!isAdmin) {
    return {
      authorized: false,
      error: "Acceso denegado: se requieren permisos de administración global.",
    };
  }

  return { authorized: true, user };
}
