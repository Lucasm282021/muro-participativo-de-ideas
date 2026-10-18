import assert from "node:assert/strict";
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
});
