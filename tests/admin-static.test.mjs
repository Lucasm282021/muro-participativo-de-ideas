import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  adminDeleteActivitySchema,
  adminDeleteIdeaSchema,
  adminModerateIdeaSchema,
  adminToggleActivitySchema,
} from "../src/app/admin/schemas.ts";
import { checkAdminAuthorization } from "../src/lib/auth/admin.ts";

test("adminModerateIdeaSchema: validación estricta de esquemas", () => {
  // Casos válidos
  const validPublished = adminModerateIdeaSchema.safeParse({
    ideaId: "41f75ade-ec13-47d0-b4af-4892fecf2d66",
    status: "published",
  });
  assert.equal(validPublished.success, true);

  const validHidden = adminModerateIdeaSchema.safeParse({
    ideaId: "fcce2179-9553-4927-aa16-78018a822b24",
    status: "hidden",
  });
  assert.equal(validHidden.success, true);

  // Casos inválidos: UUID malformado
  const invalidUuid = adminModerateIdeaSchema.safeParse({
    ideaId: "invalid-uuid-string",
    status: "published",
  });
  assert.equal(invalidUuid.success, false);
  assert.match(
    invalidUuid.error?.issues[0]?.message ?? "",
    /Identificador de idea inválido/,
  );

  // Casos inválidos: estado fuera de catálogo
  const invalidStatus = adminModerateIdeaSchema.safeParse({
    ideaId: "41f75ade-ec13-47d0-b4af-4892fecf2d66",
    status: "deleted",
  });
  assert.equal(invalidStatus.success, false);
  assert.match(
    invalidStatus.error?.issues[0]?.message ?? "",
    /Estado de moderación inválido/,
  );

  // Casos inválidos: inyección o tipo erróneo
  const injectionAttempt = adminModerateIdeaSchema.safeParse({
    ideaId: "41f75ade-ec13-47d0-b4af-4892fecf2d66' OR 1=1; --",
    status: "published",
  });
  assert.equal(injectionAttempt.success, false);
});

test("adminToggleActivitySchema: validación de ciclo de actividad", () => {
  // Casos válidos
  const validOpen = adminToggleActivitySchema.safeParse({
    activityId: "f5bb3ff8-ebd4-46ae-bad7-f51ceb7b4ed1",
    status: "open",
  });
  assert.equal(validOpen.success, true);

  const validClosed = adminToggleActivitySchema.safeParse({
    activityId: "b046cb97-dbf2-4926-8161-95564db60b3d",
    status: "closed",
  });
  assert.equal(validClosed.success, true);

  // Casos inválidos
  const invalidStatus = adminToggleActivitySchema.safeParse({
    activityId: "f5bb3ff8-ebd4-46ae-bad7-f51ceb7b4ed1",
    status: "draft",
  });
  assert.equal(invalidStatus.success, false);

  const missingId = adminToggleActivitySchema.safeParse({
    status: "open",
  });
  assert.equal(missingId.success, false);
});

test("adminDeleteActivitySchema: doble barrera con código de confirmación", () => {
  // Caso válido: 8 caracteres exactos
  const valid = adminDeleteActivitySchema.safeParse({
    activityId: "f5bb3ff8-ebd4-46ae-bad7-f51ceb7b4ed1",
    confirmationCode: "AU453878",
  });
  assert.equal(valid.success, true);

  // Caso válido con espacios que son saneados con trim
  const validWithSpaces = adminDeleteActivitySchema.safeParse({
    activityId: "f5bb3ff8-ebd4-46ae-bad7-f51ceb7b4ed1",
    confirmationCode: "  AU453878  ",
  });
  assert.equal(validWithSpaces.success, true);

  // Código corto (menos de 8 caracteres)
  const tooShort = adminDeleteActivitySchema.safeParse({
    activityId: "f5bb3ff8-ebd4-46ae-bad7-f51ceb7b4ed1",
    confirmationCode: "AU453",
  });
  assert.equal(tooShort.success, false);
  assert.match(tooShort.error?.issues[0]?.message ?? "", /8 caracteres/);

  // Código largo (más de 8 caracteres)
  const tooLong = adminDeleteActivitySchema.safeParse({
    activityId: "f5bb3ff8-ebd4-46ae-bad7-f51ceb7b4ed1",
    confirmationCode: "AU453878999",
  });
  assert.equal(tooLong.success, false);
  assert.match(tooLong.error?.issues[0]?.message ?? "", /8 caracteres/);
});

test("adminDeleteIdeaSchema: borrado individual de ideas", () => {
  // UUID válido
  const valid = adminDeleteIdeaSchema.safeParse({
    ideaId: "41f75ade-ec13-47d0-b4af-4892fecf2d66",
  });
  assert.equal(valid.success, true);

  // UUID malformado
  const invalid = adminDeleteIdeaSchema.safeParse({
    ideaId: "not-a-valid-uuid",
  });
  assert.equal(invalid.success, false);
  assert.match(
    invalid.error?.issues[0]?.message ?? "",
    /Identificador de idea inválido/,
  );

  // Entrada vacía
  const empty = adminDeleteIdeaSchema.safeParse({});
  assert.equal(empty.success, false);
});

test("checkAdminAuthorization: simulación estática de control de acceso en servidor", async () => {
  // Caso 1: Usuario no autenticado (sin sesión)
  const mockUnauthClient = {
    auth: {
      getUser: async () => ({
        data: { user: null },
        error: new Error("No session"),
      }),
    },
    rpc: async () => ({ data: null, error: null }),
  };

  const unauthResult = await checkAdminAuthorization(mockUnauthClient);
  assert.equal(unauthResult.authorized, false);
  assert.match(unauthResult.error ?? "", /No se identificó una sesión activa/);

  // Caso 2: Usuario autenticado pero sin rol admin (is_admin devuelve false)
  const mockNonAdminClient = {
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-123", email: "organizer@example.com" } },
        error: null,
      }),
    },
    rpc: async (fn) => {
      if (fn === "is_admin") return { data: false, error: null };
      return { data: null, error: null };
    },
  };

  const nonAdminResult = await checkAdminAuthorization(mockNonAdminClient);
  assert.equal(nonAdminResult.authorized, false);
  assert.match(
    nonAdminResult.error ?? "",
    /Acceso denegado: se requieren permisos/,
  );

  // Caso 3: Error de base de datos en rpc('is_admin')
  const mockErrorRpcClient = {
    auth: {
      getUser: async () => ({
        data: { user: { id: "admin-123", email: "admin@example.com" } },
        error: null,
      }),
    },
    rpc: async () => ({
      data: null,
      error: { message: "connection refused", code: "PGRST000" },
    }),
  };

  const errorRpcResult = await checkAdminAuthorization(mockErrorRpcClient);
  assert.equal(errorRpcResult.authorized, false);
  assert.match(
    errorRpcResult.error ?? "",
    /No fue posible verificar el rol administrativo/,
  );

  // Caso 4: Administrador plenamente autorizado
  const mockAdminClient = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "b8d6bffc-c617-49a8-b75f-1765b177b9d5",
            email: "admin@example.com",
          },
        },
        error: null,
      }),
    },
    rpc: async (fn) => {
      if (fn === "is_admin") return { data: true, error: null };
      return { data: null, error: null };
    },
  };

  const adminResult = await checkAdminAuthorization(mockAdminClient);
  assert.equal(adminResult.authorized, true);
  if (adminResult.authorized) {
    assert.equal(adminResult.user.id, "b8d6bffc-c617-49a8-b75f-1765b177b9d5");
  }

  // Caso 5: authError no nulo aunque user estuviera poblado (ej. token revocado/expirado)
  const mockTokenRevokedClient = {
    auth: {
      getUser: async () => ({
        data: { user: { id: "revoked-123" } },
        error: new Error("JWT expired or revoked"),
      }),
    },
    rpc: async () => ({ data: true, error: null }),
  };
  const tokenRevokedResult = await checkAdminAuthorization(mockTokenRevokedClient);
  assert.equal(tokenRevokedResult.authorized, false);
  assert.match(tokenRevokedResult.error ?? "", /No se identificó una sesión activa/);

  // Caso 6: is_admin retorna null o valor no booleano
  const mockNullRpcClient = {
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-456" } },
        error: null,
      }),
    },
    rpc: async () => ({ data: null, error: null }),
  };
  const nullRpcResult = await checkAdminAuthorization(mockNullRpcClient);
  assert.equal(nullRpcResult.authorized, false);
  assert.match(nullRpcResult.error ?? "", /Acceso denegado/);
});

test("superficie de ataque: ausencia de Server Actions o funciones públicas de asignación de roles", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const appActionsPath = path.resolve("src/app/actions.ts");
  const adminActionsPath = path.resolve("src/app/admin/actions.ts");

  const appActionsCode = await fs.readFile(appActionsPath, "utf-8");
  const adminActionsCode = await fs.readFile(adminActionsPath, "utf-8");

  // Ningún archivo de acciones debe contener mutaciones directas hacia user_roles
  assert.doesNotMatch(
    appActionsCode,
    /\.from\(\s*["']user_roles["']\s*\)/,
    "src/app/actions.ts no debe interactuar con user_roles",
  );
  assert.doesNotMatch(
    adminActionsCode,
    /\.from\(\s*["']user_roles["']\s*\)/,
    "src/app/admin/actions.ts no debe interactuar con user_roles",
  );

  // Ningún archivo debe exportar funciones con nombres de asignación de roles
  const forbiddenPatterns = [
    /export\s+async\s+function\s+.*admin.*role/i,
    /export\s+async\s+function\s+.*grant.*admin/i,
    /export\s+async\s+function\s+.*assign.*role/i,
    /export\s+async\s+function\s+.*promote.*user/i,
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(
      appActionsCode,
      pattern,
      `src/app/actions.ts no debe exportar funciones coincidentes con ${pattern}`,
    );
    assert.doesNotMatch(
      adminActionsCode,
      pattern,
      `src/app/admin/actions.ts no debe exportar funciones coincidentes con ${pattern}`,
    );
  }
});

test("seguridad de aprovisionamiento: scripts y documentación sin credenciales ni UUIDs operativos reales", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const scriptPath = path.resolve("scripts/admin/assign_admin_global.sql");
  const docPath = path.resolve("docs/admin_role_procedure.md");

  const scriptContent = await fs.readFile(scriptPath, "utf-8");
  const docContent = await fs.readFile(docPath, "utf-8");

  // El script debe utilizar explícitamente el marcador de posición y no un email o UUID real
  assert.match(
    scriptContent,
    /c_target_email\s+CONSTANT\s+text\s*:=\s*'PLACEHOLDER_USER_EMAIL'/,
    "El script debe contener el marcador de posición PLACEHOLDER_USER_EMAIL",
  );

  // El script debe incluir la guarda de seguridad obligatoria contra ejecución involuntaria
  assert.match(
    scriptContent,
    /IF\s+c_target_email\s*=\s*'PLACEHOLDER_USER_EMAIL'/,
    "El script debe abortar si el marcador de posición no ha sido reemplazado",
  );

  // Ningún archivo debe contener claves de servicio o tokens sensibles de Supabase
  const sensitiveTokens = [
    /sbp_[a-zA-Z0-9_-]+/,
    /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9._-]+/, // JWTs estáticos
    /service_role_key/i,
  ];

  for (const tokenRegex of sensitiveTokens) {
    assert.doesNotMatch(
      scriptContent,
      tokenRegex,
      "scripts/admin/assign_admin_global.sql no debe contener tokens sensibles",
    );
    assert.doesNotMatch(
      docContent,
      tokenRegex,
      "docs/admin_role_procedure.md no debe contener tokens sensibles",
    );
  }
});

test("consistencia arquitectónica: procedimiento alineado con esquema relacional de Migración 5", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const docPath = path.resolve("docs/admin_role_procedure.md");
  const scriptPath = path.resolve("scripts/admin/assign_admin_global.sql");
  const migration5Path = path.resolve("supabase/migrations/20261018040000_admin_global_authorization.sql");

  const doc = await fs.readFile(docPath, "utf-8");
  const script = await fs.readFile(scriptPath, "utf-8");
  const mig5 = await fs.readFile(migration5Path, "utf-8");

  // Confirmar que el tipo enum coincide con 'admin_global'
  assert.match(mig5, /create\s+type\s+public\.app_role\s+as\s+enum\s*\(\s*'admin_global'\s*\)/);
  assert.match(script, /'admin_global'/);
  assert.match(doc, /`admin_global`/);

  // Confirmar que la tabla referenciada coincide con 'user_roles'
  assert.match(mig5, /create\s+table\s+public\.user_roles/);
  assert.match(script, /public\.user_roles/);
  assert.match(doc, /public\.user_roles/);

  // Confirmar que la función autorizadora coincide con 'is_admin()'
  assert.match(mig5, /create\s+or\s+replace\s+function\s+public\.is_admin\(\)/);
  assert.match(doc, /public\.is_admin\(\)/);

  // Confirmar que el documento advierte explícitamente sobre la limitación de auditoría en el esquema actual
  assert.match(
    doc,
    /user_roles[\s\S]*no cuenta con triggers de auditoría automática/i,
    "El documento debe advertir sobre la ausencia de triggers en user_roles en el esquema actual",
  );
  assert.match(
    script,
    /user_roles[\s\S]*no cuenta[\s\S]*triggers automáticos/i,
    "El script debe advertir sobre la ausencia de triggers en user_roles en el esquema actual",
  );
});

// ============================================================================
// Auditoría administrativa v2 — cobertura estática
// ============================================================================
// R97 afirmó haber añadido estas comprobaciones, pero el archivo no las
// contenía. Se incorporan aquí leyendo la migración real y analizando su
// estructura (funciones, payloads JSONB y cláusulas de seguridad), no sólo
// mediante coincidencias textuales sueltas.

const AUDIT_V2_MIGRATION = path.resolve(
  "supabase/migrations/20261021140000_audit_cascade_counts_v2.sql",
);

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function extractFunction(sql, name) {
  const clean = stripSqlComments(sql);
  const header = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
    "i",
  );
  const match = header.exec(clean);
  assert.ok(match, `No se encontró la función public.${name}`);

  const bodyStart = clean.indexOf("$$", match.index);
  assert.ok(bodyStart > match.index, `public.${name} no usa delimitador $$`);

  const bodyEnd = clean.indexOf("$$", bodyStart + 2);
  assert.ok(bodyEnd > bodyStart, `public.${name} no cierra el delimitador $$`);

  return clean.slice(match.index, bodyEnd + 2);
}

function extractJsonbObjects(sql) {
  const needle = "jsonb_build_object";
  const objects = [];
  let index = sql.indexOf(needle);

  while (index !== -1) {
    const open = sql.indexOf("(", index + needle.length);
    assert.ok(open !== -1, "jsonb_build_object sin paréntesis de apertura");

    let depth = 0;
    let close = -1;
    for (let i = open; i < sql.length; i += 1) {
      if (sql[i] === "(") depth += 1;
      else if (sql[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    assert.ok(close !== -1, "jsonb_build_object sin paréntesis de cierre");

    objects.push(sql.slice(open + 1, close));
    index = sql.indexOf(needle, close);
  }

  return objects;
}

function splitTopLevel(args) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = null;

  for (let i = 0; i < args.length; i += 1) {
    const char = args[i];

    if (quote) {
      current += char;
      if (char === quote && args[i - 1] !== "\\") quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim());
}

function parsePayloads(sql) {
  const objects = extractJsonbObjects(sql);
  assert.equal(
    objects.length,
    2,
    "Se esperaban dos payloads JSONB: cascada con ideas y borrado sin ideas",
  );

  return objects.map((object) => {
    const parts = splitTopLevel(object);
    assert.equal(
      parts.length % 2,
      0,
      "jsonb_build_object debe contener pares clave/valor",
    );

    const payload = new Map();
    for (let i = 0; i < parts.length; i += 2) {
      const key = /^'([^']+)'$/.exec(parts[i]);
      assert.ok(key, `Clave JSONB inválida: ${parts[i]}`);
      payload.set(key[1], normalizeSql(parts[i + 1]));
    }
    return payload;
  });
}

test("auditoría v2: columnas aditivas de conteo y blindaje del contexto", async () => {
  const sql = await readFile(AUDIT_V2_MIGRATION, "utf8");
  const clean = stripSqlComments(sql);

  for (const column of ["participants_count", "idea_authors_count"]) {
    const ddl = new RegExp(
      `alter\\s+table\\s+public\\.audit_cascade_context\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\s+integer\\s+not\\s+null\\s+default\\s+0\\s*;`,
      "i",
    );
    assert.match(clean, ddl, `Falta la columna aditiva ${column}`);
  }

  assert.match(
    clean,
    /alter\s+table\s+public\.audit_cascade_context\s+enable\s+row\s+level\s+security\s*;/i,
    "El contexto de cascada debe conservar RLS",
  );
  assert.match(
    clean,
    /revoke\s+all\s+on\s+table\s+public\.audit_cascade_context\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i,
    "El contexto de cascada no debe ser accesible por roles públicos",
  );

  const before = normalizeSql(
    extractFunction(sql, "fn_audit_activity_before_delete"),
  );
  assert.match(
    before,
    /insert\s+into\s+public\.audit_cascade_context\s*\(\s*activity_id\s*,\s*tx_id\s*,\s*ideas_count\s*,\s*participants_count\s*,\s*idea_authors_count\s*\)/i,
    "El BEFORE DELETE debe escribir los tres conteos en el contexto",
  );
});

test("auditoría v2: los conteos se capturan antes del borrado del padre", async () => {
  const sql = await readFile(AUDIT_V2_MIGRATION, "utf8");
  const before = normalizeSql(
    extractFunction(sql, "fn_audit_activity_before_delete"),
  );

  for (const table of ["ideas", "participants", "idea_authors"]) {
    const count = new RegExp(
      `count\\s*\\(\\s*\\*\\s*\\)[\\s\\S]*?from\\s+public\\.${table}\\s+where\\s+activity_id\\s*=\\s*old\\.id`,
      "i",
    );
    assert.match(
      before,
      count,
      `El BEFORE DELETE debe contar las filas existentes de ${table}`,
    );
  }

  assert.match(
    before,
    /on\s+conflict\s*\(\s*activity_id\s*,\s*tx_id\s*\)\s+do\s+update/i,
    "La captura de conteos debe ser idempotente dentro de la transacción",
  );

  const after = normalizeSql(
    extractFunction(sql, "fn_audit_activity_after_delete"),
  );
  assert.doesNotMatch(
    after,
    /count\s*\(\s*\*\s*\)/i,
    "El AFTER DELETE no debe recontar hijos: el orden de cascada no es garantizable",
  );
  assert.match(
    after,
    /delete\s+from\s+public\.audit_cascade_context[\s\S]*?returning\s+ideas_count\s*,\s*participants_count\s*,\s*idea_authors_count/i,
    "El AFTER DELETE debe leer y purgar los conteos capturados",
  );
});

test("auditoría v2: payload consolidado con tres conteos y contract_version=2", async () => {
  const sql = await readFile(AUDIT_V2_MIGRATION, "utf8");
  const after = extractFunction(sql, "fn_audit_activity_after_delete");
  const [cascade, simple] = parsePayloads(after);

  for (const payload of [cascade, simple]) {
    assert.equal(payload.get("contract_version"), "2");
    assert.ok(payload.has("ideas_deleted_count"));
    assert.ok(payload.has("participants_deleted_count"));
    assert.ok(payload.has("idea_authors_deleted_count"));
  }

  assert.equal(cascade.get("ideas_deleted_count"), "v_ideas_count");
  assert.equal(
    cascade.get("participants_deleted_count"),
    "v_participants_count",
  );
  assert.equal(
    cascade.get("idea_authors_deleted_count"),
    "v_idea_authors_count",
  );

  assert.equal(simple.get("ideas_deleted_count"), "0");
  assert.equal(simple.get("participants_deleted_count"), "v_participants_count");
  assert.equal(
    simple.get("idea_authors_deleted_count"),
    "v_idea_authors_count",
  );

  assert.match(
    normalizeSql(after),
    /if\s+v_ideas_count\s*>\s*0\s+then[\s\S]*?'activity_delete_cascade'[\s\S]*?else[\s\S]*?'activity_delete'/i,
    "El evento consolidado debe discriminar cascada y borrado sin ideas",
  );
});

test("auditoría v2: el borrado individual no altera los contadores de cascada", async () => {
  const sql = await readFile(AUDIT_V2_MIGRATION, "utf8");
  const ideaDelete = normalizeSql(
    extractFunction(sql, "fn_audit_idea_delete"),
  );

  assert.doesNotMatch(ideaDelete, /ideas_count\s*=\s*ideas_count\s*\+\s*1/i);
  assert.doesNotMatch(ideaDelete, /update\s+public\.audit_cascade_context/i);
  assert.doesNotMatch(ideaDelete, /count\s*\(\s*\*\s*\)/i);

  assert.match(
    ideaDelete,
    /from\s+public\.audit_cascade_context[\s\S]*?activity_id\s*=\s*old\.activity_id[\s\S]*?tx_id\s*=\s*txid_current\(\)/i,
    "El disparador de ideas debe consultar el contexto de la transacción",
  );
  assert.match(
    ideaDelete,
    /if\s+not\s+v_is_cascade\s+then[\s\S]*?'idea_delete_individual'/i,
    "Sólo el borrado individual debe emitir idea_delete_individual",
  );
});

test("auditoría v2: compatibilidad histórica sin backfill ni mutación de audit_logs", async () => {
  const raw = await readFile(AUDIT_V2_MIGRATION, "utf8");
  const clean = stripSqlComments(raw);

  assert.doesNotMatch(clean, /\bupdate\s+public\.audit_logs\b/i);
  assert.doesNotMatch(clean, /\bdelete\s+from\s+public\.audit_logs\b/i);
  assert.doesNotMatch(clean, /alter\s+table\s+public\.audit_logs\b/i);
  assert.doesNotMatch(clean, /add\s+column[^;]*contract_version/i);

  assert.match(
    raw,
    /hist[oó]ricos?[\s\S]{0,200}contract_version[\s\S]{0,200}(versi[oó]n\s*1|v1)/i,
    "La migración debe documentar el fallback v1 para registros históricos",
  );

  const adminPage = await readFile(
    path.resolve("src/app/admin/page.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    adminPage,
    /contract_version|participants_deleted_count|idea_authors_deleted_count/,
    "La UI no debe asumir campos v2 al mostrar registros históricos",
  );
});

test("auditoría v2: funciones endurecidas y sin ejecución directa", async () => {
  const sql = await readFile(AUDIT_V2_MIGRATION, "utf8");
  const clean = stripSqlComments(sql);

  for (const name of [
    "fn_audit_activity_before_delete",
    "fn_audit_activity_after_delete",
    "fn_audit_idea_delete",
  ]) {
    const fn = normalizeSql(extractFunction(sql, name));

    assert.match(fn, /security\s+definer/i, `${name} debe ser SECURITY DEFINER`);
    assert.match(
      fn,
      /set\s+search_path\s*=\s*''/i,
      `${name} debe fijar search_path vacío`,
    );

    const revoke = new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\s*\\(\\s*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
      "i",
    );
    assert.match(clean, revoke, `${name} debe revocar ejecución directa`);
  }
});


