import { type NextRequest, NextResponse } from "next/server";
import type { ExportableIdea } from "@/lib/export/csv";
import { generateCsv } from "@/lib/export/csv";
import type { ExportableActivity } from "@/lib/export/html";
import { generateHtmlSlideDeck } from "@/lib/export/html";
import {
  BATCH_SIZE,
  type ExportSupabaseClient,
  exportQuerySchema,
  MAX_EXPORT_LIMIT,
} from "@/lib/export/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  injectedSupabase?: ExportSupabaseClient,
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

  // 2. Autenticación con sesión Supabase (permite injectedSupabase tipado para testing controlado)
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
  if (countError || typeof initialCount !== "number") {
    return NextResponse.json(
      {
        error: "database_error",
        message: "Error al consultar el conteo de ideas.",
      },
      { status: 500 },
    );
  }

  const expectedCount = initialCount;

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

  // 5. Paginación por cursor determinista (keyset pagination)
  // Ancla cada lote al último par (created_at, id) para evitar corrimientos por offset ante mutaciones
  const allIdeas: ExportableIdea[] = [];
  const seenIds = new Set<string>();
  let hasDuplicates = false;
  let lastCursor: { created_at: string; id: string } | null = null;
  let hasMore = expectedCount > 0;

  while (hasMore) {
    let batchQuery = supabase
      .from("ideas")
      .select("id, content, status, created_at, published_at")
      .eq("activity_id", id);

    if (scope === "published") {
      batchQuery = batchQuery.eq("status", "published");
    }

    if (lastCursor) {
      batchQuery = batchQuery.or(
        `created_at.gt.${lastCursor.created_at},and(created_at.eq.${lastCursor.created_at},id.gt.${lastCursor.id})`,
      );
    }

    const { data: batchData, error: batchError } = await batchQuery
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(0, BATCH_SIZE - 1);

    if (batchError) {
      return NextResponse.json(
        { error: "database_error", message: "Error al recuperar las ideas." },
        { status: 500 },
      );
    }

    const batch = (batchData ?? []) as ExportableIdea[];
    if (batch.length === 0) {
      break;
    }

    for (const idea of batch) {
      if (seenIds.has(idea.id)) {
        hasDuplicates = true;
      } else {
        seenIds.add(idea.id);
      }
      allIdeas.push(idea);
    }

    if (batch.length < BATCH_SIZE || allIdeas.length >= expectedCount) {
      hasMore = false;
    } else {
      const lastIdea = batch[batch.length - 1];
      lastCursor = { created_at: lastIdea.created_at, id: lastIdea.id };
    }
  }

  // 6. Verificación de integridad, reconteo y detección de inconsistencias concurrentes
  let verifyQuery = supabase
    .from("ideas")
    .select("id", { count: "exact", head: true })
    .eq("activity_id", id);

  if (scope === "published") {
    verifyQuery = verifyQuery.eq("status", "published");
  }

  const { count: recount, error: recountError } = await verifyQuery;
  if (recountError || typeof recount !== "number") {
    return NextResponse.json(
      {
        error: "database_error",
        message: "Error al verificar el conteo final de ideas.",
      },
      { status: 500 },
    );
  }

  if (recount > MAX_EXPORT_LIMIT) {
    return NextResponse.json(
      {
        error: "payload_too_large",
        message: `La actividad excede el límite máximo de ${MAX_EXPORT_LIMIT.toLocaleString("es-AR")} ideas para exportación directa.`,
        total: recount,
      },
      { status: 413 },
    );
  }

  if (
    hasDuplicates ||
    seenIds.size !== allIdeas.length ||
    allIdeas.length !== expectedCount ||
    recount !== expectedCount ||
    allIdeas.length !== recount
  ) {
    return NextResponse.json(
      {
        error: "export_inconsistency",
        message:
          "No se pudo garantizar la integridad completa de la exportación debido a cambios concurrentes o discrepancia en los registros. Por favor, reintentá la descarga.",
        expected: expectedCount,
        retrieved: allIdeas.length,
        recount,
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
