import assert from "node:assert/strict";
import test from "node:test";
import {
  ideaSchema,
  resolveSubmitIdeaOutcome,
} from "../src/app/idea-schema.ts";

test("ideaSchema: validación de casos válidos y saneamiento trim", () => {
  // Caso estándar válido
  const valid = ideaSchema.safeParse({
    first_name: "María",
    last_name: "González",
    email: "maria.gonzalez@example.com",
    content: "Propongo sumar bancos y árboles en el patio central.",
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.first_name, "María");
    assert.equal(valid.data.last_name, "González");
    assert.equal(valid.data.email, "maria.gonzalez@example.com");
    assert.equal(
      valid.data.content,
      "Propongo sumar bancos y árboles en el patio central.",
    );
  }

  // Saneamiento de espacios en blanco en extremos (trim)
  const padded = ideaSchema.safeParse({
    first_name: "  Lucas  ",
    last_name: "  Montero  ",
    email: "lucas@example.test",
    content: "   Idea con espacios alrededor.   ",
  });
  assert.equal(padded.success, true);
  if (padded.success) {
    assert.equal(padded.data.first_name, "Lucas");
    assert.equal(padded.data.last_name, "Montero");
    assert.equal(padded.data.content, "Idea con espacios alrededor.");
  }

  // Soporte de caracteres especiales, acentos, puntuación y emojis
  const specialChars = ideaSchema.safeParse({
    first_name: "Agustín",
    last_name: "O'Connor",
    email: "agustin.oconnor@subdominio.com.ar",
    content:
      "¡Excelente iniciativa! ¿Podríamos incorporar energía solar? ☀️🔋✨ (100% renovable)",
  });
  assert.equal(specialChars.success, true);
});

test("ideaSchema: límites de longitud en el contenido de la idea (1 a 500 caracteres)", () => {
  // Exactamente 1 carácter (límite inferior válido)
  const minContent = ideaSchema.safeParse({
    first_name: "Ana",
    last_name: "Pérez",
    email: "ana@example.com",
    content: "X",
  });
  assert.equal(minContent.success, true);

  // Exactamente 500 caracteres (límite superior válido)
  const exact500 = "A".repeat(500);
  const maxContent = ideaSchema.safeParse({
    first_name: "Ana",
    last_name: "Pérez",
    email: "ana@example.com",
    content: exact500,
  });
  assert.equal(maxContent.success, true);
  if (maxContent.success) {
    assert.equal(maxContent.data.content.length, 500);
  }

  // 501 caracteres (supera límite superior)
  const over500 = "A".repeat(501);
  const invalidOverMax = ideaSchema.safeParse({
    first_name: "Ana",
    last_name: "Pérez",
    email: "ana@example.com",
    content: over500,
  });
  assert.equal(invalidOverMax.success, false);
  assert.match(
    invalidOverMax.error?.issues[0]?.message ?? "",
    /La idea no puede superar los 500 caracteres/,
  );

  // Cadena vacía
  const emptyContent = ideaSchema.safeParse({
    first_name: "Ana",
    last_name: "Pérez",
    email: "ana@example.com",
    content: "",
  });
  assert.equal(emptyContent.success, false);
  assert.match(
    emptyContent.error?.issues[0]?.message ?? "",
    /Escribí una idea/,
  );

  // Solo espacios en blanco (trim resulta en longitud 0)
  const whitespaceContent = ideaSchema.safeParse({
    first_name: "Ana",
    last_name: "Pérez",
    email: "ana@example.com",
    content: "     \n\t   ",
  });
  assert.equal(whitespaceContent.success, false);
  assert.match(
    whitespaceContent.error?.issues[0]?.message ?? "",
    /Escribí una idea/,
  );
});

test("ideaSchema: validación estricta de nombre y apellido del participante", () => {
  // first_name vacío
  const missingFirstName = ideaSchema.safeParse({
    first_name: "",
    last_name: "García",
    email: "test@example.com",
    content: "Una propuesta válida.",
  });
  assert.equal(missingFirstName.success, false);
  assert.match(
    missingFirstName.error?.issues[0]?.message ?? "",
    /Ingresá tu nombre/,
  );

  // first_name de solo espacios
  const spacesFirstName = ideaSchema.safeParse({
    first_name: "    ",
    last_name: "García",
    email: "test@example.com",
    content: "Una propuesta válida.",
  });
  assert.equal(spacesFirstName.success, false);
  assert.match(
    spacesFirstName.error?.issues[0]?.message ?? "",
    /Ingresá tu nombre/,
  );

  // first_name mayor a 100 caracteres
  const longFirstName = ideaSchema.safeParse({
    first_name: "A".repeat(101),
    last_name: "García",
    email: "test@example.com",
    content: "Una propuesta válida.",
  });
  assert.equal(longFirstName.success, false);

  // last_name vacío
  const missingLastName = ideaSchema.safeParse({
    first_name: "Carlos",
    last_name: "",
    email: "test@example.com",
    content: "Una propuesta válida.",
  });
  assert.equal(missingLastName.success, false);
  assert.match(
    missingLastName.error?.issues[0]?.message ?? "",
    /Ingresá tu apellido/,
  );

  // last_name mayor a 100 caracteres
  const longLastName = ideaSchema.safeParse({
    first_name: "Carlos",
    last_name: "B".repeat(101),
    email: "test@example.com",
    content: "Una propuesta válida.",
  });
  assert.equal(longLastName.success, false);
});

test("ideaSchema: validación estricta de dirección de correo electrónico", () => {
  // Email sin arroba
  const noAt = ideaSchema.safeParse({
    first_name: "Lucía",
    last_name: "Ríos",
    email: "correo-invalido.com",
    content: "Propuesta válida.",
  });
  assert.equal(noAt.success, false);
  assert.match(noAt.error?.issues[0]?.message ?? "", /Ingresá un email válido/);

  // Email sin dominio
  const noDomain = ideaSchema.safeParse({
    first_name: "Lucía",
    last_name: "Ríos",
    email: "lucia@",
    content: "Propuesta válida.",
  });
  assert.equal(noDomain.success, false);
  assert.match(
    noDomain.error?.issues[0]?.message ?? "",
    /Ingresá un email válido/,
  );

  // Email vacío
  const emptyEmail = ideaSchema.safeParse({
    first_name: "Lucía",
    last_name: "Ríos",
    email: "",
    content: "Propuesta válida.",
  });
  assert.equal(emptyEmail.success, false);
  assert.match(
    emptyEmail.error?.issues[0]?.message ?? "",
    /Ingresá un email válido/,
  );

  // Email mayor a 254 caracteres (246 + 9 = 255 caracteres)
  const longDomain = `${"a".repeat(246)}@test.com`;
  const tooLongEmail = ideaSchema.safeParse({
    first_name: "Lucía",
    last_name: "Ríos",
    email: longDomain,
    content: "Propuesta válida.",
  });
  assert.equal(tooLongEmail.success, false);
});

test("resolveSubmitIdeaOutcome: validación unitaria de contratos nuevo y legacy", () => {
  // NOTA METODOLÓGICA (P1-R62): Esta prueba unitaria valida la función pura de resolución de contratos
  // y mapeo de estados utilizada por submitIdeaAction en producción. No afirma constituir por sí sola
  // una prueba de integración completa de transporte/red, la cual es cubierta en submit-idea-dynamic.

  // 1. Contrato Vigente (A2): outcome = 'accepted', status = 'published'
  const resPublished = resolveSubmitIdeaOutcome(
    [
      {
        outcome: "accepted",
        idea_id: "e9f7833a-8677-4b13-9111-a832c38d2121",
        idea_status: "published",
      },
    ],
    null,
  );
  assert.equal(resPublished.success, "¡Tu idea ya está en el muro!");
  assert.equal(resPublished.revalidate, true);
  assert.equal(resPublished.error, undefined);

  // 2. Contrato Vigente (A2): outcome = 'accepted', status = 'pending'
  const resPending = resolveSubmitIdeaOutcome(
    [
      {
        outcome: "accepted",
        idea_id: "c2a93321-4321-4b13-8888-b999c38d4444",
        idea_status: "pending",
      },
    ],
    null,
  );
  assert.equal(
    resPending.success,
    "¡Gracias! Tu idea quedó pendiente de aprobación.",
  );
  assert.equal(resPending.revalidate, true);
  assert.equal(resPending.error, undefined);

  // 3. Contrato Vigente (A2): outcome = 'duplicate'
  const resDuplicate = resolveSubmitIdeaOutcome(
    [
      {
        outcome: "duplicate",
        idea_id: null,
        idea_status: null,
      },
    ],
    null,
  );
  assert.equal(
    resDuplicate.error,
    "Ya enviaste una idea igual en esta actividad. Probá con una idea distinta.",
  );
  assert.equal(resDuplicate.revalidate, undefined);
  assert.equal(resDuplicate.success, undefined);

  // 4. Contrato Vigente (A2): outcome = 'rate_limited'
  const resRateLimited = resolveSubmitIdeaOutcome(
    [
      {
        outcome: "rate_limited",
        idea_id: null,
        idea_status: null,
      },
    ],
    null,
  );
  assert.equal(
    resRateLimited.error,
    "Enviaste varias ideas seguidas. Esperá un minuto antes de sumar otra.",
  );
  assert.equal(resRateLimited.revalidate, undefined);
  assert.equal(resRateLimited.success, undefined);

  // 5. Contrato Legacy (RPC previa sin columna outcome, con idea_id e idea_status = 'published')
  const resLegacyPublished = resolveSubmitIdeaOutcome(
    [
      {
        idea_id: "a1a1a1a1-2222-3333-4444-555555555555",
        idea_status: "published",
      },
    ],
    null,
  );
  assert.equal(
    resLegacyPublished.success,
    "¡Tu idea ya está en el muro!",
    "El contrato legacy debe retornar éxito para ideas publicadas",
  );
  assert.equal(
    resLegacyPublished.revalidate,
    true,
    "El contrato legacy debe habilitar revalidación de rutas",
  );
  assert.equal(resLegacyPublished.error, undefined);

  // 6. Contrato Legacy (RPC previa sin columna outcome, con idea_id e idea_status = 'pending')
  const resLegacyPending = resolveSubmitIdeaOutcome(
    [
      {
        idea_id: "b2b2b2b2-3333-4444-5555-666666666666",
        idea_status: "pending",
      },
    ],
    null,
  );
  assert.equal(
    resLegacyPending.success,
    "¡Gracias! Tu idea quedó pendiente de aprobación.",
    "El contrato legacy debe retornar éxito para ideas pendientes",
  );
  assert.equal(
    resLegacyPending.revalidate,
    true,
    "El contrato legacy debe habilitar revalidación de rutas",
  );
  assert.equal(resLegacyPending.error, undefined);

  // 7. Error de base de datos o RPC
  const resRpcError = resolveSubmitIdeaOutcome(
    null,
    new Error("PGRST000 connection error"),
  );
  assert.equal(
    resRpcError.error,
    "La actividad ya no recibe ideas o hubo un problema. Volvé a intentarlo.",
  );

  // 8. Respuesta vacía sin filas
  const resEmptyData = resolveSubmitIdeaOutcome([], null);
  assert.equal(
    resEmptyData.error,
    "La actividad ya no recibe ideas o hubo un problema. Volvé a intentarlo.",
  );
});
