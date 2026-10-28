import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { AdminActivityRow } from "@/app/admin/components/admin-activity-row";
import { AdminIdeaRow } from "@/app/admin/components/admin-idea-row";
import { checkAdminAuthorization } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import type { Activity, Idea } from "@/lib/types";
import "./admin.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Administración Global — Muro común",
  description:
    "Panel centralizado de supervisión, moderación y control operativo.",
};

function isValidCount(val: unknown): val is number {
  return typeof val === "number" && Number.isInteger(val) && val >= 0;
}

function resolveActivityCode(
  payload: Record<string, unknown> | null,
): string | null {
  if (
    payload &&
    typeof payload.public_code === "string" &&
    payload.public_code.trim().length > 0
  ) {
    return payload.public_code.trim();
  }
  return null;
}

export function resolveAuditPresentation(log: {
  action: string;
  payload: Record<string, unknown> | null;
}) {
  let actionBadge = {
    label: log.action,
    bg: "#f0eee4",
    color: "#555",
  };

  if (log.action === "idea_moderate_status") {
    actionBadge = {
      label: "Moderación Idea",
      bg: "#fdf8ee",
      color: "#745814",
    };
  } else if (log.action === "activity_status_change") {
    actionBadge = {
      label: "Ciclo Actividad",
      bg: "#f1f6ed",
      color: "#2f5c35",
    };
  } else if (log.action === "idea_delete_individual") {
    actionBadge = {
      label: "Borrado Idea",
      bg: "#fdf5f4",
      color: "#923226",
    };
  } else if (
    log.action === "activity_delete" ||
    log.action === "activity_delete_cascade"
  ) {
    actionBadge = {
      label: "Borrado de actividad",
      bg: "#fdf5f4",
      color: "#923226",
    };
  }

  let detailText = "Registro de operación";

  if (log.action === "idea_moderate_status") {
    detailText = `${String(log.payload?.old_status ?? "")} → ${String(log.payload?.new_status ?? "")}`;
  } else if (log.action === "activity_status_change") {
    detailText = `${String(log.payload?.old_status ?? "")} → ${String(log.payload?.new_status ?? "")} (${String(log.payload?.public_code ?? "")})`;
  } else if (log.action === "idea_delete_individual") {
    detailText = `Idea eliminada (longitud: ${String(log.payload?.content_length ?? "-")})`;
  } else if (log.action === "activity_delete") {
    const code = resolveActivityCode(log.payload);
    detailText = code ? `Actividad ${code} eliminada` : "Actividad eliminada";
  } else if (log.action === "activity_delete_cascade") {
    const code = resolveActivityCode(log.payload);
    const baseText = code
      ? `Actividad ${code} eliminada`
      : "Actividad eliminada";

    const payload = log.payload;
    const isV2 =
      payload !== null &&
      typeof payload === "object" &&
      (payload.contract_version === 2 || payload.contract_version === "2");
    const isV1 =
      payload !== null &&
      typeof payload === "object" &&
      (payload.contract_version === undefined ||
        payload.contract_version === null);

    if (isV2) {
      const parts: string[] = [];
      if (isValidCount(payload.ideas_deleted_count)) {
        const count = payload.ideas_deleted_count;
        parts.push(`${count} ${count === 1 ? "idea" : "ideas"}`);
      }
      if (isValidCount(payload.participants_deleted_count)) {
        const count = payload.participants_deleted_count;
        parts.push(
          `${count} ${count === 1 ? "participante" : "participantes"}`,
        );
      }
      if (isValidCount(payload.idea_authors_deleted_count)) {
        const count = payload.idea_authors_deleted_count;
        parts.push(`${count} ${count === 1 ? "autor" : "autores"}`);
      }

      detailText =
        parts.length > 0 ? `${baseText} (${parts.join(", ")})` : baseText;
    } else if (isV1) {
      // Registros históricos V1: contract_version ausente o null
      if (isValidCount(payload.ideas_deleted_count)) {
        const count = payload.ideas_deleted_count;
        detailText = `${baseText} (${count} ${count === 1 ? "idea" : "ideas"})`;
      } else {
        detailText = baseText;
      }
    } else {
      // Versión desconocida o malformada: no interpretar como V1 ni inventar conteos
      detailText = baseText;
    }
  }

  return { actionBadge, detailText };
}

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  // 1. Verificación obligatoria de identidad de sesión
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/ingresar");
  }

  // 2. Verificación autoritativa fresca de rol admin_global en servidor
  const authResult = await checkAdminAuthorization(supabase);

  // Denegación estricta de acceso: HTTP 403 si la autorización no es positiva
  if (!authResult.authorized) {
    forbidden();
  }

  // 3. Consultas en el servidor (alcanzables únicamente por administradores verificados)
  let activities: Activity[] = [];
  let ideas: Idea[] = [];
  let auditLogs: {
    id: string;
    target_table: string;
    target_id: string;
    action: string;
    actor_id: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
  }[] = [];
  let activitiesError: { message: string; code?: string } | null = null;
  let ideasError: { message: string; code?: string } | null = null;
  let auditLogsError: { message: string; code?: string } | null = null;

  const { data: rawActivities, error: actErr } = await supabase
    .from("activities")
    .select(
      "id, public_code, title, question, status, moderation_mode, created_at, opened_at, closed_at",
    )
    .order("created_at", { ascending: false });

  if (actErr) {
    activitiesError = actErr;
  } else {
    activities = (rawActivities ?? []) as Activity[];
  }

  const { data: rawIdeas, error: idErr } = await supabase
    .from("ideas")
    .select("id, activity_id, content, status, created_at, published_at")
    .order("created_at", { ascending: false })
    .limit(30);

  if (idErr) {
    ideasError = idErr;
  } else {
    ideas = (rawIdeas ?? []) as Idea[];
  }

  const { data: rawAuditLogs, error: auditErr } = await supabase
    .from("audit_logs")
    .select(
      "id, target_table, target_id, action, actor_id, payload, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(15);

  if (auditErr) {
    auditLogsError = auditErr;
  } else {
    auditLogs = (rawAuditLogs ?? []) as typeof auditLogs;
  }

  // Métricas reales calculadas
  const openActivitiesCount = activities.filter(
    (a) => a.status === "open",
  ).length;
  const closedActivitiesCount = activities.filter(
    (a) => a.status === "closed",
  ).length;
  const pendingIdeasCount = ideas.filter((i) => i.status === "pending").length;

  return (
    <main className="dashboard-page">
      {/* Navegación unificada con identidad de marca */}
      <header className="dashboard-nav">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link className="brand brand-dark" href="/">
            <span className="brand-mark">
              m<span>.</span>
            </span>
            <span>
              muro<span className="brand-light">común</span>
            </span>
          </Link>
          <span className="admin-badge-role">Admin Global</span>
        </div>

        <div className="nav-actions">
          <Link className="nav-signin" href="/panel">
            ← Mi Panel
          </Link>
          <span className="account-email">{user.email}</span>
          <form action={signOutAction}>
            <button type="submit" className="nav-signin">
              Salir
            </button>
          </form>
        </div>
      </header>

      <section className="dashboard-main">
        {/* Encabezado visual principal */}
        <div className="dashboard-heading">
          <div>
            <div className="eyebrow">ADMINISTRACIÓN GLOBAL DEL SISTEMA</div>
            <h1>
              Supervisión de actividades
              <br />y <em>moderación central.</em>
            </h1>
          </div>
          <span className="dashboard-mark">✳</span>
        </div>

        {/* Panel informativo de sesión autorizada */}
        <div
          className="admin-phase-notice"
          style={{ borderLeftColor: "#315a3d" }}
        >
          <span
            className="admin-notice-icon"
            style={{ color: "#315a3d" }}
            aria-hidden="true"
          >
            ✓
          </span>
          <div className="admin-phase-notice-content">
            <h4>Sesión Administrativa Autorizada</h4>
            <p>
              Rol <code>admin_global</code> verificado de forma fresca en el
              servidor mediante <code>public.is_admin()</code>. Las acciones
              operativas de moderación, cierre, reapertura y eliminación en
              cascada están habilitadas con doble barrera de seguridad.
            </p>
          </div>
        </div>

        {/* Tarjetas de resumen de indicadores */}
        <div className="admin-metrics-grid">
          <div className="admin-metric-card">
            <div className="admin-metric-header">
              <span className="admin-metric-label">Actividades Globales</span>
              <span className="status-pill status-open">Activo</span>
            </div>
            <div className="admin-metric-value">{activities.length}</div>
            <span className="admin-metric-subtext">
              {openActivitiesCount} en curso · {closedActivitiesCount} cerradas
            </span>
          </div>

          <div className="admin-metric-card">
            <div className="admin-metric-header">
              <span className="admin-metric-label">Ideas del Sistema</span>
              <span className="status-pill status-pending">Moderación</span>
            </div>
            <div className="admin-metric-value">{ideas.length}</div>
            <span className="admin-metric-subtext">
              {pendingIdeasCount} pendientes de revisión editorial
            </span>
          </div>

          <div className="admin-metric-card">
            <div className="admin-metric-header">
              <span className="admin-metric-label">Rol en Servidor</span>
              <span className="admin-badge-soon">Fase 2</span>
            </div>
            <div
              className="admin-metric-value"
              style={{ fontSize: "20px", marginTop: "10px" }}
            >
              admin_global
            </div>
            <span className="admin-metric-subtext">
              Verificación fresca confirmada en PostgreSQL.
            </span>
          </div>
        </div>

        {/* Sección 1: Gestión Global de Actividades */}
        <section className="admin-section">
          <div className="section-header">
            <div>
              <span className="section-kicker">SUPERVISIÓN GLOBAL</span>
              <h2>Gestión de Actividades</h2>
              <p className="detail-section-description">
                Consulta centralizada y control de ciclo de vida de
                conversaciones en la plataforma.
              </p>
            </div>
            <span className="activity-count">
              {String(activities.length).padStart(2, "0")}
            </span>
          </div>

          {/* Errores o restricciones informativas */}
          {activitiesError && (
            <div className="admin-error-notice">
              <span className="admin-notice-icon" aria-hidden="true">
                ⚠️
              </span>
              <div>
                <h4>Error al consultar la tabla de actividades</h4>
                <p>
                  PostgREST devolvió un error: {activitiesError.message}{" "}
                  (Código: {activitiesError.code ?? "N/A"}).
                </p>
              </div>
            </div>
          )}

          {/* Tabla de Actividades */}
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Actividad</th>
                  <th>Estado</th>
                  <th>Moderación</th>
                  <th>Código</th>
                  <th>Acciones Administrativas</th>
                </tr>
              </thead>
              <tbody>
                {activities.length > 0 ? (
                  activities.map((activity) => (
                    <AdminActivityRow key={activity.id} activity={activity} />
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        textAlign: "center",
                        padding: "24px",
                        color: "#777",
                      }}
                    >
                      No se encontraron actividades en la base de datos.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="admin-table-blueprint-footer">
              <span>
                ✳ Gestión operativa de actividades · Eliminación protegida por
                confirmación de código
              </span>
              <span className="status-pill status-open">
                Acciones activas
              </span>
            </div>
          </div>
        </section>

        {/* Sección 2: Moderación de Ideas */}
        <section className="admin-section">
          <div className="section-header">
            <div>
              <span className="section-kicker">CONTROL EDITORIAL</span>
              <h2>Moderación de Ideas</h2>
              <p className="detail-section-description">
                Supervisión del contenido aportado por participantes en todas
                las conversaciones.
              </p>
            </div>
            <span className="activity-count">
              {String(ideas.length).padStart(2, "0")}
            </span>
          </div>

          {ideasError && (
            <div className="admin-error-notice">
              <span className="admin-notice-icon" aria-hidden="true">
                ⚠️
              </span>
              <div>
                <h4>Error al consultar la tabla de ideas</h4>
                <p>
                  PostgREST devolvió un error: {ideasError.message} (Código:{" "}
                  {ideasError.code ?? "N/A"}).
                </p>
              </div>
            </div>
          )}

          {/* Tabla de Ideas */}
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Contenido de la Idea</th>
                  <th>Estado</th>
                  <th>Fecha de Registro</th>
                  <th>Acción Administrativa</th>
                </tr>
              </thead>
              <tbody>
                {ideas.length > 0 ? (
                  ideas.map((idea) => (
                    <AdminIdeaRow key={idea.id} idea={idea} />
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        textAlign: "center",
                        padding: "24px",
                        color: "#777",
                      }}
                    >
                      No se encontraron ideas registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="admin-table-blueprint-footer">
              <span>
                ✳ Moderación editorial · Mutaciones atómicas con sincronización
                de published_at
              </span>
              <span className="status-pill status-open">
                Acciones activas
              </span>
            </div>
          </div>
        </section>

        {/* Sección 3: Bitácora de Auditoría Visual */}
        <section className="admin-section">
          <div className="section-header">
            <div>
              <span className="section-kicker">REGISTRO HISTÓRICO</span>
              <h2>Bitácora de Auditoría</h2>
              <p className="detail-section-description">
                Trazabilidad de operaciones críticas en base de datos (últimos
                15 eventos). Registro relacional para supervisión operativa.
              </p>
            </div>
            <span className="activity-count">
              {String(auditLogs.length).padStart(2, "0")}
            </span>
          </div>

          {auditLogsError && (
            <div className="admin-error-notice">
              <span className="admin-notice-icon" aria-hidden="true">
                ⚠️
              </span>
              <div>
                <h4>Error al consultar la bitácora de auditoría</h4>
                <p>
                  No se pudo cargar el registro histórico (
                  {auditLogsError.message}).
                </p>
              </div>
            </div>
          )}

          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fecha y Hora</th>
                  <th>Operación</th>
                  <th>Entidad</th>
                  <th>Actor</th>
                  <th>Detalle Operativo</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length > 0 ? (
                  auditLogs.map((log) => {
                    const actorFormatted = log.actor_id
                      ? `admin-${log.actor_id.slice(0, 8)}`
                      : typeof log.payload?.actor_id_snapshot === "string"
                        ? `admin-${log.payload.actor_id_snapshot.slice(0, 8)}`
                        : "Sistema";

                    const { actionBadge, detailText } =
                      resolveAuditPresentation(log);

                    return (
                      <tr key={log.id}>
                        <td
                          style={{
                            fontSize: "11px",
                            color: "#555c53",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {new Date(log.created_at).toLocaleString("es-AR", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                        <td>
                          <span
                            style={{
                              background: actionBadge.bg,
                              color: actionBadge.color,
                              padding: "2px 8px",
                              borderRadius: "4px",
                              fontSize: "11px",
                              fontWeight: 600,
                            }}
                          >
                            {actionBadge.label}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: "12px", color: "#333" }}>
                            {log.target_table === "ideas"
                              ? "Idea"
                              : "Actividad"}
                          </span>{" "}
                          <code style={{ fontSize: "11px", color: "#777" }}>
                            {log.target_id.slice(0, 8)}...
                          </code>
                        </td>
                        <td>
                          <code
                            style={{
                              background: "#f0eee4",
                              padding: "2px 6px",
                              borderRadius: "3px",
                              fontSize: "11px",
                            }}
                          >
                            {actorFormatted}
                          </code>
                        </td>
                        <td style={{ fontSize: "11px", color: "#61685e" }}>
                          {detailText}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        textAlign: "center",
                        padding: "24px",
                        color: "#777",
                      }}
                    >
                      No se registran eventos en la bitácora de auditoría.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="admin-table-blueprint-footer">
              <span>
                📋 Bitácora histórica · No representa inmutabilidad
                criptográfica · Trazabilidad de soporte
              </span>
              <span className="status-pill status-open">
                Auditoría en vivo
              </span>
            </div>
          </div>
        </section>

        {/* Sección 4: Capacidades Futuras («Próximamente») */}
        <section className="admin-section">
          <div className="section-header">
            <div>
              <span className="section-kicker">HOJA DE RUTA</span>
              <h2>Funciones en Desarrollo</h2>
              <p className="detail-section-description">
                Módulos planificados conforme al protocolo técnico de
                administración global.
              </p>
            </div>
          </div>

          <div className="admin-roadmap-grid">
            <div className="admin-roadmap-card">
              <div>
                <div className="admin-roadmap-card-top">
                  <h3>Gestión de Usuarios y Roles</h3>
                  <span className="admin-badge-soon">Próximamente</span>
                </div>
                <p>
                  Asignación y revocación segura del rol{" "}
                  <code>admin_global</code> y consulta de perfiles organizadores
                  mediante consola de infraestructura protegida.
                </p>
              </div>
              <div className="admin-roadmap-footer">
                <span>🔒 Procedimiento fuera de la app web</span>
              </div>
            </div>

            <div className="admin-roadmap-card">
              <div>
                <div className="admin-roadmap-card-top">
                  <h3>Bitácora de Auditoría Visual</h3>
                  <span className="status-pill status-open">Activa</span>
                </div>
                <p>
                  Panel de supervisión histórica conectada a{" "}
                  <code>public.audit_logs</code> con filtrado RLS y trazabilidad
                  de eventos del sistema.
                </p>
              </div>
              <div className="admin-roadmap-footer">
                <span>✓ Módulo operativo en panel</span>
              </div>
            </div>

            <div className="admin-roadmap-card">
              <div>
                <div className="admin-roadmap-card-top">
                  <h3>Estadísticas Avanzadas</h3>
                  <span className="admin-badge-soon">Próximamente</span>
                </div>
                <p>
                  Métricas de participación agregada, tiempos promedio de
                  respuesta y volumen de ideas sin exposición de datos
                  personales.
                </p>
              </div>
              <div className="admin-roadmap-footer">
                <span>📊 Módulo de analítica agregada</span>
              </div>
            </div>

            <div className="admin-roadmap-card">
              <div>
                <div className="admin-roadmap-card-top">
                  <h3>Exportación de Datos</h3>
                  <span className="admin-badge-soon">Próximamente</span>
                </div>
                <p>
                  Generación de volcados de datos en formato CSV y JSON
                  estructurado para análisis externo e informes institucionales.
                </p>
              </div>
              <div className="admin-roadmap-footer">
                <span>📁 Exportación segura por streaming</span>
              </div>
            </div>

            <div className="admin-roadmap-card">
              <div>
                <div className="admin-roadmap-card-top">
                  <h3>Configuración Global</h3>
                  <span className="admin-badge-soon">Próximamente</span>
                </div>
                <p>
                  Ajustes de límites de tasa, directivas de retención de datos y
                  parámetros operativos de la plataforma.
                </p>
              </div>
              <div className="admin-roadmap-footer">
                <span>⚙️ Panel de variables operativas</span>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
