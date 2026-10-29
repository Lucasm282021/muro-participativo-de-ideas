import { type NextRequest, NextResponse } from "next/server";
import { generateCsv } from "@/lib/export/csv";
import { generateHtmlSlideDeck } from "@/lib/export/html";
import {
  BATCH_SIZE,
  MAX_EXPORT_LIMIT,
  exportQuerySchema,
} from "@/lib/export/schemas";
import { createClient } from "@/lib/supabase/server";
import type { ExportableActivity } from "@/lib/export/html";
import type { ExportableIdea } from "@/lib/export/csv";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  injectedSupabase?: any,
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

  // 2. Autenticación con sesión Supabase (permite injectedSupabase para testing controlado del handler)
  const supabase = injectedSupabase ?? (await createClient());
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;

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

  // 4. Conteo inicial y control de desbordamiento (tope 5.000 ideas)
  let countQuery = supabase
    .from("ideas")
    .select("id", { count: "exact", head: true })
    .eq("activity_id", id);

  if (scope === "published") {
    countQuery = countQuery.eq("status", "published");
  }

  const { count: initialCount, error: countError } = await countQuery;
  if (countError) {
    return NextResponse.json(
      { error: "database_error", message: "Error al consultar las ideas." },
      { status: 500 },
    );
  }

  const expectedCount = initialCount ?? 0;

  if (expectedCount > MAX_EXPORT_LIMIT) {
    return NextResponse.json(
      {
        error: "payload_too_large",
        message: `La actividad excede el límite máximo de ${MAX_EXPORT_LIMIT.toLocaleString("es-AR")} ideas para exportación directa.`,
        total: expectedCount,
      },
      { status: 413 },
    );
  }

  // 5. Paginación en bloques (BATCH_SIZE = 1000) respetando el límite por consulta de PostgREST
  const allIdeas: ExportableIdea[] = [];
  let fromOffset = 0;

  while (fromOffset < expectedCount) {
    const toOffset = Math.min(fromOffset + BATCH_SIZE - 1, expectedCount - 1);

    let batchQuery = supabase
      .from("ideas")
      .select("id, content, status, created_at, published_at")
      .eq("activity_id", id);

    if (scope === "published") {
      batchQuery = batchQuery.eq("status", "published");
    }

    const { data: batchData, error: batchError } = await batchQuery
      .order("created_at", { ascending: true })
      .range(fromOffset, toOffset);

    if (batchError) {
      return NextResponse.json(
        { error: "database_error", message: "Error al recuperar las ideas." },
        { status: 500 },
      );
    }

    const batch = (batchData ?? []) as ExportableIdea[];
    if (batch.length === 0) {
      // Discrepancia: la base devolvió 0 filas antes de alcanzar expectedCount
      break;
    }

    allIdeas.push(...batch);
    fromOffset += batch.length;
  }

  // 6. Verificación de integridad y consistencia
  // Comprobar que no haya truncamiento ni carreras de concurrencia
  if (allIdeas.length !== expectedCount) {
    let verifyQuery = supabase
      .from("ideas")
      .select("id", { count: "exact", head: true })
      .eq("activity_id", id);

    if (scope === "published") {
      verifyQuery = verifyQuery.eq("status", "published");
    }

    const { count: recount } = await verifyQuery;
    if ((recount ?? 0) > MAX_EXPORT_LIMIT) {
      return NextResponse.json(
        {
          error: "payload_too_large",
          message: `La actividad excede el límite máximo de ${MAX_EXPORT_LIMIT.toLocaleString("es-AR")} ideas para exportación directa.`,
          total: recount,
        },
        { status: 413 },
      );
    }

    // Si la cantidad recuperada no coincide con el conteo esperado, nunca devolver 200 incompleto
    return NextResponse.json(
      {
        error: "export_inconsistency",
        message:
          "No se pudo garantizar la integridad completa de la exportación debido a cambios concurrentes o discrepancia en el conteo. Por favor, reintentá la descarga.",
        expected: expectedCount,
        retrieved: allIdeas.length,
      },
      { status: 409 },
    );
  }

  // 7. Generación de contenido según formato
  let fileContent: string;
  let contentType: string;

  if (format === "csv") {
    fileContent = generateCsv(allIdeas, scope);
    contentType = "text/csv; charset=utf-8";
  } else {
    fileContent = generateHtmlSlideDeck(activity, allIdeas, scope);
    contentType = "text/html; charset=utf-8";
  }

  // 8. Construcción de nombre de archivo seguro
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
