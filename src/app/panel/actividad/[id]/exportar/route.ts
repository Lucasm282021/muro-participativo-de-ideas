import { type NextRequest, NextResponse } from "next/server";
import { generateCsv } from "@/lib/export/csv";
import { generateHtmlSlideDeck } from "@/lib/export/html";
import {
  type ExportSupabaseClient,
  exportQuerySchema,
  exportRpcResponseSchema,
  MAX_EXPORT_LIMIT,
} from "@/lib/export/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function buildExportResponse(
  activity: Parameters<typeof generateHtmlSlideDeck>[0],
  ideas: Parameters<typeof generateCsv>[0],
  format: "csv" | "html",
  scope: "published" | "all",
) {
  let fileContent: string;
  let contentType: string;

  if (format === "csv") {
    fileContent = generateCsv(ideas, scope);
    contentType = "text/csv; charset=utf-8";
  } else {
    fileContent = generateHtmlSlideDeck(activity, ideas, scope);
    contentType = "text/html; charset=utf-8";
  }

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

  // 3. Invocación atómica exclusiva de la función RPC export_activity_ideas
  if (typeof supabase.rpc !== "function") {
    return NextResponse.json(
      {
        error: "export_service_unavailable",
        message: "El servicio de exportación no está disponible temporalmente.",
      },
      { status: 503 },
    );
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "export_activity_ideas",
    {
      target_activity_id: id,
      export_scope: scope,
    },
  );

  // 4. Manejo de errores controlados de la base de datos
  if (rpcError) {
    const err = rpcError as { code?: string };
    if (err.code === "42501") {
      return new NextResponse(null, { status: 401 });
    }
    if (err.code === "P0002") {
      return new NextResponse(null, { status: 404 });
    }
    if (err.code === "42883" || err.code === "PGRST202") {
      return NextResponse.json(
        {
          error: "export_service_unavailable",
          message:
            "El servicio de exportación no está disponible temporalmente.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error: "database_error",
        message: "Error al invocar la función de exportación.",
      },
      { status: 500 },
    );
  }

  // 5. Validación estricta del contrato RPC con Zod
  const rpcValidation = exportRpcResponseSchema.safeParse(rpcData);
  if (!rpcValidation.success) {
    return NextResponse.json(
      {
        error: "export_contract_error",
        message: "Respuesta de exportación inválida.",
      },
      { status: 500 },
    );
  }

  const validated = rpcValidation.data;

  // 6. Manejo de desbordamiento reportado por la RPC
  if (validated.error === "payload_too_large") {
    return NextResponse.json(
      {
        error: "payload_too_large",
        message: `La actividad excede el límite máximo de ${MAX_EXPORT_LIMIT.toLocaleString("es-AR")} ideas para exportación directa.`,
        total: validated.total,
      },
      { status: 413 },
    );
  }

  // 7. Verificación de integridad entre total declarado y registros recibidos
  const { activity, ideas, total } = validated;

  if (total > MAX_EXPORT_LIMIT || ideas.length > MAX_EXPORT_LIMIT) {
    return NextResponse.json(
      {
        error: "payload_too_large",
        message: `La actividad excede el límite máximo de ${MAX_EXPORT_LIMIT.toLocaleString("es-AR")} ideas para exportación directa.`,
        total: Math.max(total, ideas.length),
      },
      { status: 413 },
    );
  }

  if (ideas.length !== total) {
    return NextResponse.json(
      {
        error: "export_contract_error",
        message:
          "Inconsistencia entre el total declarado y la cantidad de registros recibidos.",
      },
      { status: 500 },
    );
  }

  // 8. Construcción de respuesta
  return buildExportResponse(activity, ideas, format, scope);
}
