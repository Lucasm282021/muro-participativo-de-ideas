import Link from "next/link";
import { redirect } from "next/navigation";
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
  const isAuthorizedAdmin = authResult.authorized;

  // 3. Consultas condicionales en el servidor
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

  if (isAuthorizedAdmin) {
    // Si el usuario está acreditado como admin_global, consultar el universo global
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
  }

  // Métricas reales calculadas exclusivamente cuando el rol está verificado
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
          {isAuthorizedAdmin ? (
            <span className="admin-badge-role">Admin Global</span>
          ) : (
            <span className="admin-badge-preview">
              Vista previa · Sin rol asignado
            </span>
          )}
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

        {/* Panel informativo de estado de autorización */}
        {!isAuthorizedAdmin ? (
          <div className="admin-phase-notice">
            <span className="admin-notice-icon" aria-hidden="true">
              ℹ
            </span>
            <div className="admin-phase-notice-content">
              <h4>
                Estado de Autorización — Pendiente de Provisión en Base de Datos
              </h4>
              <p>
                Tu sesión está identificada en Supabase Auth, pero la función
                autorizadora en servidor indicó que la cuenta no cuenta con el
                rol <code>admin_global</code> activo en{" "}
                <code>public.user_roles</code> (o la migración DDL
                correspondiente no ha sido aplicada aún). Las operaciones
                globales y la lectura de registros ajenos permanecen bloqueadas
                por políticas de seguridad RLS.
              </p>
            </div>
          </div>
        ) : (
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
        )}

        {/* Tarjetas de resumen de indicadores */}
        <div className="admin-metrics-grid">
          <div className="admin-metric-card">
            <div className="admin-metric-header">
              <span className="admin-metric-label">Actividades Globales</span>
              {isAuthorizedAdmin ? (
                <span className="status-pill status-open">Activo</span>
              ) : (
                <span className="admin-badge-blocked">Pendiente RLS</span>
              )}
            </div>
            <div className="admin-metric-value">
              {isAuthorizedAdmin ? activities.length : "Pendiente"}
            </div>
            <span className="admin-metric-subtext">
              {isAuthorizedAdmin
                ? `${openActivitiesCount} en curso · ${closedActivitiesCount} cerradas`
                : "Políticas RLS actuales aíslan por propietario (owner_id = auth.uid())."}
            </span>
          </div>

          <div className="admin-metric-card">
            <div className="admin-metric-header">
              <span className="admin-metric-label">Ideas del Sistema</span>
              {isAuthorizedAdmin ? (
                <span className="status-pill status-pending">Moderación</span>
              ) : (
                <span className="admin-badge-blocked">Pendiente RLS</span>
              )}
            </div>
            <div className="admin-metric-value">
              {isAuthorizedAdmin ? ideas.length : "Pendiente"}
            </div>
            <span className="admin-metric-subtext">
              {isAuthorizedAdmin
                ? `${pendingIdeasCount} pendientes de revisión editorial`
                : "La auditoría entre actividades requiere autorización de rol en servidor."}
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
              {isAuthorizedAdmin ? "admin_global" : "Sin rol global"}
            </div>
            <span className="admin-metric-subtext">
              {isAuthorizedAdmin
                ? "Verificación fresca confirmada en PostgreSQL."
                : "Sesión identificada · Autorización DDL pendiente en BD."}
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
              {isAuthorizedAdmin
                ? String(activities.length).padStart(2, "0")
                : "—"}
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

          {!isAuthorizedAdmin && !activitiesError && (
            <div className="admin-rls-notice">
              <span className="admin-notice-icon" aria-hidden="true">
                🔒
              </span>
              <div>
                <h4>Lectura global no disponible con el esquema actual</h4>
                <p>
                  Las políticas RLS vigentes en la base de datos limitan la
                  lectura de actividades estrictamente al organizador
                  propietario (<code>owner_id = auth.uid()</code>). Para evitar
                  presentar datos parciales como si fuesen una supervisión
                  global, la carga operativa de registros se activará tras
                  autorizarse y aplicarse la migración DDL de Fase 2.
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
                {isAuthorizedAdmin && activities.length > 0 ? (
                  activities.map((activity) => (
                    <AdminActivityRow key={activity.id} activity={activity} />
                  ))
                ) : isAuthorizedAdmin && activities.length === 0 ? (
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
                ) : (
                  <tr>
                    <td>
                      <div className="admin-table-title">
                        Actividad de muestra (Estructura visual)
                      </div>
                      <div className="admin-table-desc">
                        Visualización esquemática de la disposición de columnas
                        para Fase 2.
                      </div>
                    </td>
                    <td>
                      <span className="status-pill status-open">En curso</span>
                    </td>
                    <td>
                      <span style={{ fontSize: "11px", color: "#61685e" }}>
                        Publicación directa
                      </span>
                    </td>
                    <td>
                      <code
                        style={{
                          background: "#f0eee4",
                          padding: "3px 6px",
                          borderRadius: "3px",
                          fontSize: "11px",
                        }}
                      >
                        DEMO-01
                      </code>
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        className="admin-action-disabled"
                      >
                        Gestionar (Próximamente)
                      </button>
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
              <span
                className={
                  isAuthorizedAdmin
                    ? "status-pill status-open"
                    : "admin-badge-soon"
                }
              >
                {isAuthorizedAdmin ? "Acciones activas" : "Controles inactivos"}
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
              {isAuthorizedAdmin ? String(ideas.length).padStart(2, "0") : "—"}
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

          {!isAuthorizedAdmin && !ideasError && (
            <div className="admin-rls-notice">
              <span className="admin-notice-icon" aria-hidden="true">
                🔒
              </span>
              <div>
                <h4>Moderación centralizada restringida por RLS</h4>
                <p>
                  En el esquema actual, la lectura y moderación de ideas solo
                  está permitida al organizador vinculado a la actividad. La
                  auditoría central y las acciones administrativas de
                  publicación u ocultamiento global se habilitarán en la Fase 2
                  mediante Server Actions con validación estricta de{" "}
                  <code>public.is_admin()</code>.
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
                {isAuthorizedAdmin && ideas.length > 0 ? (
                  ideas.map((idea) => (
                    <AdminIdeaRow key={idea.id} idea={idea} />
                  ))
                ) : isAuthorizedAdmin && ideas.length === 0 ? (
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
                ) : (
                  <tr>
                    <td>
                      <div
                        style={{
                          maxWidth: "460px",
                          lineHeight: "1.5",
                          color: "#555c53",
                        }}
                      >
                        Contenido de muestra representativo de la tipografía y
                        disposición visual del muro.
                      </div>
                    </td>
                    <td>
                      <span className="status-pill status-pending">
                        Pendiente
                      </span>
                    </td>
                    <td style={{ fontSize: "11px", color: "#8a8f86" }}>—</td>
                    <td>
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        className="admin-action-disabled"
                      >
                        Moderar (Próximamente)
                      </button>
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
              <span
                className={
                  isAuthorizedAdmin
                    ? "status-pill status-open"
                    : "admin-badge-soon"
                }
              >
                {isAuthorizedAdmin ? "Acciones activas" : "Controles inactivos"}
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
              {isAuthorizedAdmin
                ? String(auditLogs.length).padStart(2, "0")
                : "—"}
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

          {!isAuthorizedAdmin && !auditLogsError && (
            <div className="admin-rls-notice">
              <span className="admin-notice-icon" aria-hidden="true">
                🔒
              </span>
              <div>
                <h4>Acceso a bitácora restringido por RLS</h4>
                <p>
                  La lectura de <code>public.audit_logs</code> requiere
                  autorización con el rol <code>admin_global</code> activo.
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
                {isAuthorizedAdmin && auditLogs.length > 0 ? (
                  auditLogs.map((log) => {
                    const actorFormatted = log.actor_id
                      ? `admin-${log.actor_id.slice(0, 8)}`
                      : typeof log.payload?.actor_id_snapshot === "string"
                        ? `admin-${log.payload.actor_id_snapshot.slice(0, 8)}`
                        : "Sistema";

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
                    } else if (log.action === "activity_delete_cascade") {
                      actionBadge = {
                        label: "Borrado Actividad",
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
                    } else if (log.action === "activity_delete_cascade") {
                      detailText = `Actividad ${String(log.payload?.public_code ?? "")} eliminada`;
                    }

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
                ) : isAuthorizedAdmin && auditLogs.length === 0 ? (
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
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        textAlign: "center",
                        padding: "20px",
                        color: "#8a8f86",
                        fontSize: "12px",
                      }}
                    >
                      Visualización disponible para cuentas con rol
                      administrativo acreditado.
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
              <span
                className={
                  isAuthorizedAdmin
                    ? "status-pill status-open"
                    : "admin-badge-soon"
                }
              >
                {isAuthorizedAdmin ? "Auditoría en vivo" : "Sin acceso"}
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
