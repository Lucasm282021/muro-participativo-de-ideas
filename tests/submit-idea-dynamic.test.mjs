import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

// Helper para cargar variables de entorno locales desde .env.local sin librerías externas
function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadLocalEnv();

const SUPABASE_LOCAL_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:25435";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.SYNTHETIC_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SYNTHETIC_ADMIN_PASSWORD;

test("submit_idea: prueba dinámica completa y de concurrencia en Supabase local", async () => {
  // 1. Verificación obligatoria de aislamiento local y presencia de variables de entorno
  assert.ok(
    SUPABASE_ANON_KEY,
    "Precondición fallida: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no está configurada en el entorno.",
  );
  assert.ok(
    ADMIN_EMAIL && ADMIN_PASSWORD,
    "Precondición fallida: SYNTHETIC_ADMIN_EMAIL o SYNTHETIC_ADMIN_PASSWORD no están configuradas en .env.local.",
  );

  const urlObj = new URL(SUPABASE_LOCAL_URL);
  assert.equal(
    urlObj.hostname === "127.0.0.1" || urlObj.hostname === "localhost",
    true,
    "Guardia de aislamiento: la URL no es local",
  );
  assert.equal(
    urlObj.port,
    "25435",
    "Guardia de aislamiento: el puerto no coincide con el puerto local 25435",
  );

  // Cliente administrativo local para setup y teardown de la actividad sintética
  const adminClient = createClient(SUPABASE_LOCAL_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } =
    await adminClient.auth.signInWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

  assert.equal(
    authError,
    null,
    `Error de autenticación local: ${authError?.message}`,
  );
  assert.ok(authData?.user, "Se requiere usuario autenticado");

  // Verificar recuento inicial de actividades antes de la prueba
  const { count: initialActivityCount, error: countErr } = await adminClient
    .from("activities")
    .select("*", { count: "exact", head: true });
  assert.equal(countErr, null);
  assert.equal(
    initialActivityCount,
    28,
    "La base debe contener exactamente 28 actividades preexistentes",
  );

  // Cliente anónimo público para probar las invocaciones de submit_idea
  const anonClient = createClient(SUPABASE_LOCAL_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const SYNTHETIC_PUBLIC_CODE = "ZA2TEST1";
  let createdActivityId = null;

  try {
    // 2. Crear actividad sintética para la prueba
    const { data: newActivity, error: createActError } = await adminClient
      .from("activities")
      .insert({
        owner_id: authData.user.id,
        public_code: SYNTHETIC_PUBLIC_CODE,
        title: "ZZTESTR60-Validacion-Dinamica-A2",
        question:
          "¿Cuáles son las ideas para validar submit_idea dinámicamente?",
        status: "open",
        moderation_mode: "automatic",
        opened_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    assert.equal(
      createActError,
      null,
      `Error creando actividad: ${createActError?.message}`,
    );
    assert.ok(newActivity?.id);
    createdActivityId = newActivity.id;

    const participantEmail = "tester.a2.dynamic@synthetic.local";

    // 3. Caso A: Envío secuencial válido inicial -> accepted / published
    const { data: res1, error: err1 } = await anonClient.rpc("submit_idea", {
      activity_code: SYNTHETIC_PUBLIC_CODE,
      participant_first_name: "Tester",
      participant_last_name: "A2 Dinámico",
      participant_email: participantEmail,
      idea_content: "Propuesta número 1 de prueba dinámica",
    });

    assert.equal(err1, null, `Error en res1: ${err1?.message}`);
    assert.equal(res1?.length, 1);
    assert.equal(res1[0].outcome, "accepted");
    assert.ok(res1[0].idea_id, "Debe retornar un UUID de idea");
    assert.equal(res1[0].idea_status, "published");

    // 4. Caso B: Deduplicación permanente -> duplicate
    const { data: resDup, error: errDup } = await anonClient.rpc(
      "submit_idea",
      {
        activity_code: SYNTHETIC_PUBLIC_CODE,
        participant_first_name: "Tester",
        participant_last_name: "A2 Dinámico",
        participant_email: participantEmail,
        idea_content: "   PROPUESTA   NÚMERO 1 DE PRUEBA DINÁMICA   ",
      },
    );

    assert.equal(errDup, null, `Error en resDup: ${errDup?.message}`);
    assert.equal(resDup?.length, 1);
    assert.equal(resDup[0].outcome, "duplicate");
    assert.equal(resDup[0].idea_id, null);
    assert.equal(resDup[0].idea_status, null);

    // 5. Caso C: Concurrencia real 1 — Deduplicación idéntica bajo ráfaga (2 solicitudes simultáneas)
    const duplicateBurstEmail = "burst.dedupe@synthetic.local";
    const burstContent = "Propuesta enviada en ráfaga simultánea para dedupe";

    const burstDedupePromises = [
      anonClient.rpc("submit_idea", {
        activity_code: SYNTHETIC_PUBLIC_CODE,
        participant_first_name: "Burst",
        participant_last_name: "Dedupe",
        participant_email: duplicateBurstEmail,
        idea_content: burstContent,
      }),
      anonClient.rpc("submit_idea", {
        activity_code: SYNTHETIC_PUBLIC_CODE,
        participant_first_name: "Burst",
        participant_last_name: "Dedupe",
        participant_email: duplicateBurstEmail,
        idea_content: `  ${burstContent}  `,
      }),
    ];

    const burstDedupeResults = await Promise.all(burstDedupePromises);
    const outcomesDedupe = burstDedupeResults.map((r) => r.data?.[0]?.outcome);

    assert.equal(
      outcomesDedupe.filter((o) => o === "accepted").length,
      1,
      "Exactamente 1 solicitud concurrente idéntica debe ser aceptada",
    );
    assert.equal(
      outcomesDedupe.filter((o) => o === "duplicate").length,
      1,
      "Exactamente 1 solicitud concurrente idéntica debe ser rechazada como duplicada",
    );

    // 6. Caso D: Concurrencia real 2 — Rate limit bajo ráfaga (8 solicitudes simultáneas distintas)
    const burstRateLimitEmail = "burst.ratelimit@synthetic.local";
    const burstRateLimitPromises = Array.from({ length: 8 }, (_, idx) =>
      anonClient.rpc("submit_idea", {
        activity_code: SYNTHETIC_PUBLIC_CODE,
        participant_first_name: "Burst",
        participant_last_name: "RateLimit",
        participant_email: burstRateLimitEmail,
        idea_content: `Idea concurrente en ráfaga número ${idx + 1}`,
      }),
    );

    const burstRateResults = await Promise.all(burstRateLimitPromises);
    const outcomesRate = burstRateResults.map((r) => r.data?.[0]?.outcome);

    const acceptedCount = outcomesRate.filter((o) => o === "accepted").length;
    const rateLimitedCount = outcomesRate.filter(
      (o) => o === "rate_limited",
    ).length;

    assert.equal(
      acceptedCount,
      5,
      "Bajo ráfaga concurrente de 8 ideas distintas, deben aceptarse exactamente 5",
    );
    assert.equal(
      rateLimitedCount,
      3,
      "Bajo ráfaga concurrente de 8 ideas distintas, deben rechazarse exactamente 3 por rate limit",
    );

    // Verificar en BD que el conteo de ideas del participante en ráfaga sea exactamente 5
    const { count: burstIdeasInDb, error: burstCountErr } = await adminClient
      .from("ideas")
      .select(
        "*, idea_authors!inner(participant_id, participants!inner(email))",
        {
          count: "exact",
          head: true,
        },
      )
      .eq("activity_id", createdActivityId)
      .eq("idea_authors.participants.email", burstRateLimitEmail);

    assert.equal(burstCountErr, null);
    assert.equal(
      burstIdeasInDb,
      5,
      "La base de datos debe contener exactamente 5 ideas del participante de ráfaga",
    );

    // 7. Caso E: Validación de datos a nivel SQL (error 22023)
    const { error: errInvalidEmail } = await anonClient.rpc("submit_idea", {
      activity_code: SYNTHETIC_PUBLIC_CODE,
      participant_first_name: "Tester",
      participant_last_name: "A2",
      participant_email: "email-invalido-sin-arroba",
      idea_content: "Texto válido",
    });
    assert.ok(errInvalidEmail, "Debe arrojar error para email inválido");
    assert.match(
      errInvalidEmail.message,
      /Invalid submission data/,
      "Debe disparar la excepción SQL 22023",
    );

    // 8. Caso F: Actividad inexistente (error P0002)
    const { error: errNonExistent } = await anonClient.rpc("submit_idea", {
      activity_code: "NONEXIST",
      participant_first_name: "Tester",
      participant_last_name: "A2",
      participant_email: "tester@synthetic.local",
      idea_content: "Texto válido",
    });
    assert.ok(errNonExistent, "Debe arrojar error para actividad inexistente");
    assert.match(
      errNonExistent.message,
      /Activity not found/,
      "Debe disparar la excepción SQL P0002",
    );

    // 9. Caso G: Seguridad de privilegios - Intento de INSERT directo denegado para anon
    const { error: directInsertError } = await anonClient.from("ideas").insert({
      activity_id: createdActivityId,
      content: "Intento no autorizado de inserción directa",
    });
    assert.ok(
      directInsertError,
      "El rol anon no debe poder hacer INSERT directo en ideas",
    );
    assert.match(
      directInsertError.message,
      /permission denied|violates row-level security policy/i,
    );
  } finally {
    // 10. Teardown riguroso: Eliminar la actividad sintética y verificar integridad
    if (createdActivityId) {
      const { error: deleteError } = await adminClient
        .from("activities")
        .delete()
        .eq("id", createdActivityId);
      assert.equal(
        deleteError,
        null,
        `Error al limpiar actividad: ${deleteError?.message}`,
      );
    }

    // Verificar que los conteos regresan estrictamente a la línea base inicial
    const { count: finalActivitiesCount } = await adminClient
      .from("activities")
      .select("*", { count: "exact", head: true });
    assert.equal(
      finalActivitiesCount,
      28,
      "El conteo final de actividades debe volver exactamente a 28",
    );

    const { count: finalIdeasCount } = await adminClient
      .from("ideas")
      .select("*", { count: "exact", head: true });
    assert.equal(
      finalIdeasCount,
      215,
      "El conteo final de ideas debe volver exactamente a 215",
    );
  }
});
