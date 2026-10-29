import { type NextRequest, NextResponse } from "next/server";
import { generateCsv } from "@/lib/export/csv";
import { generateHtmlSlideDeck } from "@/lib/export/html";
import { exportQuerySchema } from "@/lib/export/schemas";
import { createClient } from "@/lib/supabase/server";
import type { ExportableActivity } from "@/lib/export/html";
import type { ExportableIdea } from "@/lib/export/csv";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. Validar parámetros de consulta con Zod
  const url = new URL(request.url);
  const parseResult = exportQuerySchema.safeParse({
    format: url.searchParams.get("format"),
    scope: url.searchParams.get("scope") ?? "published",
  });

  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "invalid_parameters",
        message: "Parámetros de exportación inválidos",
        issues: parseResult.error.format(),
      },
      { status: 400 },
    );
  }

  const { format, scope } = parseResult.data;

  // 2. Autenticación con sesión Supabase
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse(null, { status: 401 });
  }

  // 3. Verificación de propiedad de la actividad
  // Si la actividad no existe o pertenece a otro usuario, responde 404 estricto
  const { data: rawActivity } = await supabase
    .from("activities")
    .select("id, public_code, title, question, status, created_at")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!rawActivity) {
    return new NextResponse(null, { status: 404 });
  }

  const activity = rawActivity as ExportableActivity;

  // 4. Límite de volumen y comprobación de desbordamiento (tope 5.000 ideas)
  const MAX_EXPORT_LIMIT = 5000;

  let countQuery = supabase
    .from("ideas")
    .select("id", { count: "exact", head: true })
    .eq("activity_id", id);

  if (scope === "published") {
    countQuery = countQuery.eq("status", "published");
  }

  const { count: totalIdeas, error: countError } = await countQuery;
  if (countError) {
    return NextResponse.json(
      { error: "database_error", message: "Error al consultar las ideas." },
      { status: 500 },
    );
  }

  if ((totalIdeas ?? 0) > MAX_EXPORT_LIMIT) {
    return NextResponse.json(
      {
        error: "payload_too_large",
        message: `La actividad excede el límite máximo de ${MAX_EXPORT_LIMIT.toLocaleString("es-AR")} ideas para exportación directa.`,
        total: totalIdeas,
      },
      { status: 413 },
    );
  }

  // 5. Consulta de ideas autorizadas (sin JOIN con participants ni idea_authors)
  let ideasQuery = supabase
    .from("ideas")
    .select("id, content, status, created_at, published_at")
    .eq("activity_id", id)
    .order("created_at", { ascending: true })
    .range(0, MAX_EXPORT_LIMIT - 1);

  if (scope === "published") {
    ideasQuery = ideasQuery.eq("status", "published");
  }

  const { data: rawIdeas, error: ideasError } = await ideasQuery;
  if (ideasError) {
    return NextResponse.json(
      { error: "database_error", message: "Error al recuperar las ideas." },
      { status: 500 },
    );
  }

  const ideas = (rawIdeas ?? []) as ExportableIdea[];

  // 6. Generación de contenido según formato
  let fileContent: string;
  let contentType: string;

  if (format === "csv") {
    fileContent = generateCsv(ideas, scope);
    contentType = "text/csv; charset=utf-8";
  } else {
    fileContent = generateHtmlSlideDeck(activity, ideas, scope);
    contentType = "text/html; charset=utf-8";
  }

  // 7. Construcción de nombre de archivo seguro
  const safeCode = (activity.public_code || "actividad").replace(
    /[^a-zA-Z0-9_-]/g,
    "",
  );
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `muro-${safeCode}-${dateStr}.${format}`;

  return new NextResponse(fileContent, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

