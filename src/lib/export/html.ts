export type ExportableIdea = {
  id: string;
  content: string;
  status: "pending" | "published" | "hidden";
  created_at: string;
  published_at: string | null;
  idea_number?: number | null;
};

const STATUS_LABELS: Record<ExportableIdea["status"], string> = {
  published: "Publicada",
  pending: "Pendiente",
  hidden: "Oculta",
};

export type ExportableActivity = {
  id: string;
  public_code: string;
  title: string;
  question: string;
  status: "draft" | "open" | "closed";
  created_at: string;
};

/**
 * Escapa caracteres HTML para prevenir cualquier vulnerabilidad XSS
 * al renderizar contenido proporcionado por los usuarios.
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Slide = {
  type: "cover" | "empty" | "ideas";
  ideas?: ExportableIdea[];
};

/**
 * Agrupa las ideas en diapositivas adaptativas para el modo Presentación:
 * - Ideas largas (> 140 caracteres): 1 sola idea por diapositiva para máxima legibilidad.
 * - Ideas breves/medianas (<= 140 caracteres): se agrupan hasta 4 por diapositiva.
 */
export function buildSlides(ideas: ExportableIdea[]): Slide[] {
  const slides: Slide[] = [{ type: "cover" }];

  if (ideas.length === 0) {
    slides.push({ type: "empty" });
    return slides;
  }

  let currentBatch: ExportableIdea[] = [];

  for (const idea of ideas) {
    const isLong = idea.content.trim().length > 140;

    if (isLong) {
      if (currentBatch.length > 0) {
        slides.push({ type: "ideas", ideas: [...currentBatch] });
        currentBatch = [];
      }
      slides.push({ type: "ideas", ideas: [idea] });
    } else {
      currentBatch.push(idea);
      if (currentBatch.length >= 4) {
        slides.push({ type: "ideas", ideas: [...currentBatch] });
        currentBatch = [];
      }
    }
  }

  if (currentBatch.length > 0) {
    slides.push({ type: "ideas", ideas: [...currentBatch] });
  }

  return slides;
}

/**
 * Formatea una fecha ISO a formato local amigable (es-AR).
 */
function formatDate(isoStr: string | null | undefined): string {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    return d.toLocaleString("es-AR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return isoStr;
  }
}

/**
 * Genera un documento HTML autónomo, accesible, seguro y completamente offline
 * con la identidad visual clara de Muro común y cuatro modalidades de visualización:
 * 1. Presentación (diapositivas adaptativas)
 * 2. Mosaico de ideas (grilla adaptable de tarjetas)
 * 3. Listado detallado (vista vertical ordenada)
 * 4. Análisis de resultados (métricas y distribuciones reales)
 */
export function generateHtmlSlideDeck(
  activity: ExportableActivity,
  ideas: ExportableIdea[],
  scope: "published" | "all" = "published",
): string {
  // Mapa de numeración correlativa determinista para consistencia total entre Presentación, Mosaico y Listado
  const ideaNumberMap = new Map<string, number>();
  ideas.forEach((idea, idx) => {
    ideaNumberMap.set(idea.id, idea.idea_number ?? idx + 1);
  });

  const slides = buildSlides(ideas);
  const totalSlides = slides.length;
  const generatedAt = new Date().toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const scopeLabel =
    scope === "all"
      ? "Todas las ideas (publicadas, pendientes y ocultas)"
      : "Solo ideas publicadas";

  // Isotipo oficial SVG embebido de forma autocontenida (sin xmlns para evitar peticiones HTTP)
  const officialLogoSvg = `<svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true" focusable="false" class="brand-svg"><circle cx="32" cy="32" r="32" fill="#252c25"/><text x="31" y="45" fill="#91ad72" font-family="Arial, sans-serif" font-size="37" font-weight="700" text-anchor="middle">m</text><circle cx="47" cy="43" r="2.5" fill="#f8c864"/></svg>`;

  // 1. RENDERIZADO DEL MODO PRESENTACIÓN (SLIDES)
  const renderSlidesHtml = slides
    .map((slide, index) => {
      const slideNumber = index + 1;
      const isInitial = index === 0 ? "active" : "";

      if (slide.type === "cover") {
        return `
        <article class="slide slide-cover ${isInitial}" id="slide-${slideNumber}" role="region" aria-roledescription="slide" aria-label="Portada de presentación">
          <div class="cover-content">
            <div class="brand">
              ${officialLogoSvg}
              <span class="brand-name">muro<strong>común</strong></span>
            </div>
            <div class="brand-tagline">Ideas que hacen lugar</div>
            <div class="kicker">REPORTE DE ACTIVIDAD · CÓDIGO ${escapeHtml(activity.public_code)}</div>
            <h1 class="activity-title">${escapeHtml(activity.title)}</h1>
            <p class="activity-question">${escapeHtml(activity.question)}</p>
            <div class="cover-meta">
              <div class="meta-item">
                <span class="meta-label">Total de ideas</span>
                <span class="meta-value">${ideas.length}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Alcance</span>
                <span class="meta-value">${escapeHtml(scopeLabel)}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Generado el</span>
                <span class="meta-value">${escapeHtml(generatedAt)}</span>
              </div>
            </div>
          </div>
        </article>`;
      }

      if (slide.type === "empty") {
        return `
        <article class="slide slide-empty ${isInitial}" id="slide-${slideNumber}" role="region" aria-roledescription="slide" aria-label="Sin resultados">
          <div class="empty-box">
            <span class="empty-icon" aria-hidden="true">◌</span>
            <h2>Sin ideas registradas</h2>
            <p>No se encontraron ideas para esta actividad con el alcance seleccionado (${escapeHtml(scopeLabel)}).</p>
          </div>
        </article>`;
      }

      const slideIdeas = slide.ideas ?? [];
      const isSingle = slideIdeas.length === 1;
      const layoutClass = isSingle ? "ideas-single" : `ideas-grid count-${slideIdeas.length}`;

      const ideasCards = slideIdeas
        .map((idea) => {
          const num = idea.idea_number ?? ideaNumberMap.get(idea.id);
          const numDisplay = num !== undefined ? `#${num}` : "";
          const statusBadge =
            scope === "all"
              ? `<span class="status-badge status-${escapeHtml(idea.status)}">${escapeHtml(STATUS_LABELS[idea.status] ?? idea.status)}</span>`
              : "";

          return `
          <div class="idea-card ${isSingle ? "idea-card-single" : ""}">
            <div class="idea-card-header">
              <span class="idea-number">${numDisplay}</span>
              ${statusBadge}
            </div>
            <p class="idea-content">${escapeHtml(idea.content)}</p>
          </div>`;
        })
        .join("");

      return `
      <article class="slide slide-ideas ${isInitial}" id="slide-${slideNumber}" role="region" aria-roledescription="slide" aria-label="Diapositiva ${slideNumber} de ${totalSlides}">
        <header class="slide-header">
          <span class="slide-context">${escapeHtml(activity.title)}</span>
          <span class="slide-tag">Código: ${escapeHtml(activity.public_code)}</span>
        </header>
        <div class="slide-body ${layoutClass}">
          ${ideasCards}
        </div>
      </article>`;
    })
    .join("\n");

  // 2. RENDERIZADO DEL MODO MOSAICO (CARDS GRID)
  const renderMosaicHtml =
    ideas.length === 0
      ? `
      <div class="empty-box" style="margin: 4rem auto;">
        <span class="empty-icon" aria-hidden="true">◌</span>
        <h2>Sin ideas registradas</h2>
        <p>No se encontraron ideas para esta actividad con el alcance seleccionado.</p>
      </div>`
      : `
      <div class="mosaic-grid">
        ${ideas
          .map((idea, idx) => {
            const num = idea.idea_number ?? ideaNumberMap.get(idea.id) ?? idx + 1;
            const dateStr = formatDate(idea.published_at || idea.created_at);
            const statusBadge =
              scope === "all"
                ? `<span class="status-badge status-${escapeHtml(idea.status)}">${escapeHtml(STATUS_LABELS[idea.status] ?? idea.status)}</span>`
                : "";
            return `
            <article class="mosaic-card" aria-label="Idea número ${num}">
              <header class="mosaic-card-header">
                <span class="idea-badge-num">#${num}</span>
                ${statusBadge}
              </header>
              <p class="mosaic-card-body">${escapeHtml(idea.content)}</p>
              <footer class="mosaic-card-footer">
                <span class="mosaic-date">${escapeHtml(dateStr)}</span>
                <span class="mosaic-chars">${idea.content.length} caracteres</span>
              </footer>
            </article>`;
          })
          .join("\n")}
      </div>`;

  // 3. RENDERIZADO DEL MODO LISTADO DETALLADO (LIST VIEW)
  const renderListHtml =
    ideas.length === 0
      ? `
      <div class="empty-box" style="margin: 4rem auto;">
        <span class="empty-icon" aria-hidden="true">◌</span>
        <h2>Sin ideas registradas</h2>
        <p>No se encontraron ideas para esta actividad con el alcance seleccionado.</p>
      </div>`
      : `
      <div class="list-container" role="list">
        ${ideas
          .map((idea, idx) => {
            const num = idea.idea_number ?? ideaNumberMap.get(idea.id) ?? idx + 1;
            const dateStr = formatDate(idea.published_at || idea.created_at);
            const statusBadge =
              scope === "all"
                ? `<span class="status-badge status-${escapeHtml(idea.status)}">${escapeHtml(STATUS_LABELS[idea.status] ?? idea.status)}</span>`
                : "";
            return `
            <article class="list-item" role="listitem" aria-label="Idea número ${num}">
              <div class="list-item-meta">
                <span class="list-item-num">#${String(num).padStart(2, "0")}</span>
                ${statusBadge}
                <span class="list-item-date">${escapeHtml(dateStr)}</span>
              </div>
              <div class="list-item-content">${escapeHtml(idea.content)}</div>
            </article>`;
          })
          .join("\n")}
      </div>`;

  // 4. RENDERIZADO DEL MODO ANÁLISIS DE RESULTADOS (ANALYTICS)
  // Estadísticas calculadas rigurosamente sólo a partir de los datos reales disponibles:
  const totalIdeas = ideas.length;
  let analyticsContentHtml = "";

  if (totalIdeas === 0) {
    analyticsContentHtml = `
      <div class="empty-box" style="margin: 4rem auto;">
        <span class="empty-icon" aria-hidden="true">◌</span>
        <h2>Sin datos para análisis</h2>
        <p>No se encontraron ideas para calcular métricas o distribuciones en esta actividad.</p>
      </div>`;
  } else {
    // Conteos por estado
    const publishedCount = ideas.filter((i) => i.status === "published").length;
    const pendingCount = ideas.filter((i) => i.status === "pending").length;
    const hiddenCount = ideas.filter((i) => i.status === "hidden").length;

    // Métricas de extensión textual
    const lengths = ideas.map((i) => i.content.trim().length);
    const sumLengths = lengths.reduce((acc, len) => acc + len, 0);
    const avgLength = Math.round(sumLengths / totalIdeas);
    const minLength = Math.min(...lengths);
    const maxLength = Math.max(...lengths);

    // Distribución por tramos de longitud
    const shortIdeas = ideas.filter((i) => i.content.trim().length <= 70).length;
    const mediumIdeas = ideas.filter(
      (i) => i.content.trim().length > 70 && i.content.trim().length <= 140,
    ).length;
    const longIdeas = ideas.filter((i) => i.content.trim().length > 140).length;

    const shortPct = Math.round((shortIdeas / totalIdeas) * 100);
    const medPct = Math.round((mediumIdeas / totalIdeas) * 100);
    const longPct = Math.round((longIdeas / totalIdeas) * 100);

    // Rango cronológico
    const dates = ideas
      .map((i) => (i.created_at ? new Date(i.created_at).getTime() : NaN))
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);

    const firstDateStr = dates.length > 0 ? formatDate(new Date(dates[0]).toISOString()) : "No disponible";
    const lastDateStr = dates.length > 0 ? formatDate(new Date(dates[dates.length - 1]).toISOString()) : "No disponible";

    analyticsContentHtml = `
      <div class="analytics-container">
        <div class="kpis-grid">
          <div class="kpi-card">
            <span class="kpi-label">Total de aportes</span>
            <span class="kpi-value">${totalIdeas}</span>
            <span class="kpi-sub">Ideas registradas</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Longitud promedio</span>
            <span class="kpi-value">${avgLength}</span>
            <span class="kpi-sub">Caracteres por idea</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Rango de extensión</span>
            <span class="kpi-value">${minLength} – ${maxLength}</span>
            <span class="kpi-sub">Mínimo y máximo (caracteres)</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Primer aporte</span>
            <span class="kpi-value-sm">${escapeHtml(firstDateStr)}</span>
            <span class="kpi-sub">Último: ${escapeHtml(lastDateStr)}</span>
          </div>
        </div>

        <div class="analytics-sections-grid">
          <div class="analytics-section-card">
            <h3>Distribución por extensión de ideas</h3>
            <p class="section-desc">Clasificación según la longitud del texto aportado.</p>
            <div class="dist-bars">
              <div class="dist-row">
                <div class="dist-label-line">
                  <span>Breves (1 a 70 caracteres)</span>
                  <strong>${shortIdeas} (${shortPct}%)</strong>
                </div>
                <div class="dist-bar-track">
                  <div class="dist-bar-fill dist-short" style="width: ${shortPct}%;"></div>
                </div>
              </div>
              <div class="dist-row">
                <div class="dist-label-line">
                  <span>Medianas (71 a 140 caracteres)</span>
                  <strong>${mediumIdeas} (${medPct}%)</strong>
                </div>
                <div class="dist-bar-track">
                  <div class="dist-bar-fill dist-med" style="width: ${medPct}%;"></div>
                </div>
              </div>
              <div class="dist-row">
                <div class="dist-label-line">
                  <span>Extensas (más de 140 caracteres)</span>
                  <strong>${longIdeas} (${longPct}%)</strong>
                </div>
                <div class="dist-bar-track">
                  <div class="dist-bar-fill dist-long" style="width: ${longPct}%;"></div>
                </div>
              </div>
            </div>
          </div>

          ${
            scope === "all"
              ? `
          <div class="analytics-section-card">
            <h3>Distribución por estado de moderación</h3>
            <p class="section-desc">Ideas según su condición en la actividad.</p>
            <div class="dist-bars">
              <div class="dist-row">
                <div class="dist-label-line">
                  <span>Publicadas</span>
                  <strong>${publishedCount} (${Math.round((publishedCount / totalIdeas) * 100)}%)</strong>
                </div>
                <div class="dist-bar-track">
                  <div class="dist-bar-fill dist-pub" style="width: ${Math.round((publishedCount / totalIdeas) * 100)}%;"></div>
                </div>
              </div>
              <div class="dist-row">
                <div class="dist-label-line">
                  <span>Pendientes de moderación</span>
                  <strong>${pendingCount} (${Math.round((pendingCount / totalIdeas) * 100)}%)</strong>
                </div>
                <div class="dist-bar-track">
                  <div class="dist-bar-fill dist-pend" style="width: ${Math.round((pendingCount / totalIdeas) * 100)}%;"></div>
                </div>
              </div>
              <div class="dist-row">
                <div class="dist-label-line">
                  <span>Ocultas</span>
                  <strong>${hiddenCount} (${Math.round((hiddenCount / totalIdeas) * 100)}%)</strong>
                </div>
                <div class="dist-bar-track">
                  <div class="dist-bar-fill dist-hid" style="width: ${Math.round((hiddenCount / totalIdeas) * 100)}%;"></div>
                </div>
              </div>
            </div>
          </div>`
              : `
          <div class="analytics-section-card">
            <h3>Alcance de la exportación</h3>
            <p class="section-desc">Este reporte contiene únicamente ideas con estado <strong>Publicada</strong>.</p>
            <div class="scope-notice">
              <p>Las ideas en moderación o excluidas no forman parte de este archivo para asegurar la fidelidad con lo proyectado en el muro público.</p>
            </div>
          </div>`
          }
        </div>

        <div class="methodology-note">
          <h4>Transparencia metodológica</h4>
          <p>
            Todas las estadísticas y distribuciones anteriores se calculan en tiempo de ejecución
            exclusivamente a partir de los datos reales contenidos en este documento descargado.
            La plataforma Muro común no infiere, estima ni inventa tendencias, participantes, votos o puntuaciones.
          </p>
        </div>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(activity.title)} — Muro común</title>
  <style>
    :root {
      --paper: #f6f4ef;
      --paper-surface: #edeae2;
      --card-bg: #fffefa;
      --card-border: #deded5;
      --ink: #202620;
      --ink-light: #384237;
      --muted: #545c53;
      --line: #deded5;
      --green: #b9f26f;
      --green-deep: #315c3b;
      --green-deep-hover: #26492e;
      --yellow: #f8c864;
      --accent: #315c3b;
      --focus-ring: #315c3b;
      --shadow-sm: 0 1px 3px rgba(32, 38, 32, 0.05);
      --shadow-md: 0 4px 12px rgba(32, 38, 32, 0.08);
      --font: Arial, Helvetica, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html {
      background: var(--paper);
      color: var(--ink);
      font-family: var(--font);
      scroll-behavior: smooth;
      -webkit-font-smoothing: antialiased;
    }
    body {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: var(--paper);
      color: var(--ink);
    }

    /* BARRA SUPERIOR PERSISTENTE CON LOGO Y SELECTOR DE MODALIDADES */
    .app-header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--card-bg);
      border-bottom: 1px solid var(--line);
      box-shadow: var(--shadow-sm);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.6rem 1.5rem;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .header-brand-group {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      text-decoration: none;
      color: var(--ink);
    }
    .brand-svg {
      display: inline-block;
      vertical-align: middle;
      border-radius: 50%;
    }
    .brand-name {
      font-size: 1.15rem;
      font-weight: 500;
      letter-spacing: -0.5px;
      color: var(--ink);
    }
    .brand-name strong {
      font-weight: 800;
      color: var(--green-deep);
    }
    .brand-tagline {
      font-size: 0.8rem;
      color: var(--muted);
      border-left: 1px solid var(--line);
      padding-left: 0.85rem;
      display: none;
    }
    @media (min-width: 840px) {
      .brand-tagline {
        display: inline-block;
      }
    }

    /* SELECTOR DE MODALIDADES (4 MODOS) */
    .modes-selector {
      display: inline-flex;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 3px;
      gap: 3px;
    }
    .mode-tab {
      background: transparent;
      border: 1px solid transparent;
      color: var(--muted);
      font-size: 0.85rem;
      font-weight: 600;
      padding: 0.4rem 0.85rem;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .mode-tab:hover:not(.active) {
      background: var(--paper-surface);
      color: var(--ink);
    }
    .mode-tab.active {
      background: var(--green-deep);
      color: #ffffff;
      border-color: var(--green-deep);
      box-shadow: 0 1px 2px rgba(49, 92, 59, 0.2);
    }
    .mode-tab:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }

    /* CONTENEDOR PRINCIPAL DE VISTAS */
    .view-panel {
      flex: 1;
      width: 100%;
    }
    .view-hidden {
      display: none !important;
    }

    /* ==========================================================
       MODALIDAD 1: PRESENTACIÓN (SLIDES)
       ========================================================== */
    #view-presentation {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 61px);
      position: relative;
      overflow: hidden;
    }
    .deck-container {
      flex: 1;
      position: relative;
      width: 100%;
      height: calc(100% - 60px);
    }
    .slide {
      position: absolute;
      inset: 0;
      padding: 2.5rem 3.5rem;
      display: none;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      overflow-y: auto;
      background: var(--paper);
    }
    .slide.active {
      display: flex;
    }
    .slide-cover {
      text-align: center;
    }
    .cover-content {
      max-width: 780px;
      margin: auto;
    }
    .slide-cover .brand {
      justify-content: center;
      margin-bottom: 0.5rem;
    }
    .slide-cover .brand-name {
      font-size: 1.6rem;
    }
    .slide-cover .brand-tagline {
      display: block;
      border-left: none;
      padding-left: 0;
      margin-bottom: 1.5rem;
      font-size: 0.95rem;
    }
    .kicker {
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--green-deep);
      margin-bottom: 1rem;
    }
    .activity-title {
      font-size: clamp(1.8rem, 3.5vw, 2.7rem);
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 1rem;
      letter-spacing: -1px;
      color: var(--ink);
    }
    .activity-question {
      font-size: clamp(1.05rem, 1.8vw, 1.3rem);
      color: var(--muted);
      margin-bottom: 2.2rem;
      line-height: 1.5;
    }
    .cover-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5rem;
      justify-content: center;
      padding-top: 1.5rem;
      border-top: 1px solid var(--line);
    }
    .meta-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }
    .meta-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      font-weight: 600;
    }
    .meta-value {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--ink);
    }

    .slide-header {
      width: 100%;
      max-width: 1080px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--line);
      font-size: 0.9rem;
      color: var(--muted);
    }
    .slide-context {
      font-weight: 600;
      color: var(--ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 70%;
    }
    .slide-tag {
      font-family: monospace;
      font-size: 0.8rem;
      background: var(--paper-surface);
      padding: 0.25rem 0.55rem;
      border-radius: 4px;
      border: 1px solid var(--line);
      color: var(--ink);
    }
    .slide-body {
      width: 100%;
      max-width: 1080px;
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ideas-single {
      width: 100%;
    }
    .ideas-grid {
      display: grid;
      width: 100%;
      gap: 1.25rem;
    }
    .ideas-grid.count-1 { grid-template-columns: 1fr; }
    .ideas-grid.count-2 { grid-template-columns: repeat(2, 1fr); }
    .ideas-grid.count-3 { grid-template-columns: repeat(3, 1fr); }
    .ideas-grid.count-4 { grid-template-columns: repeat(2, 1fr); }

    .idea-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-sm);
    }
    .idea-card-single {
      padding: 2.75rem;
      min-height: 260px;
      justify-content: center;
      max-width: 860px;
      margin: 0 auto;
    }
    .idea-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      min-height: 24px;
      margin-bottom: 0.75rem;
    }
    .idea-number {
      font-family: monospace;
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--muted);
    }
    .idea-content {
      font-size: 1.18rem;
      line-height: 1.55;
      color: var(--ink);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .idea-card-single .idea-content {
      font-size: clamp(1.3rem, 2.4vw, 1.85rem);
      line-height: 1.45;
      text-align: center;
    }

    .status-badge {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 0.15rem 0.55rem;
      border-radius: 9999px;
      letter-spacing: 0.05em;
    }
    .status-published { background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; }
    .status-pending { background: #fff8e1; color: #b78103; border: 1px solid #ffe082; }
    .status-hidden { background: #eceff1; color: #546e7a; border: 1px solid #cfd8dc; }

    .empty-box {
      text-align: center;
      max-width: 480px;
      padding: 2rem;
    }
    .empty-icon {
      font-size: 2.8rem;
      color: var(--muted);
      display: block;
      margin-bottom: 0.75rem;
    }
    .empty-box h2 {
      margin-bottom: 0.5rem;
      font-size: 1.4rem;
      color: var(--ink);
    }
    .empty-box p {
      color: var(--muted);
      font-size: 0.95rem;
      line-height: 1.5;
    }

    .deck-nav {
      height: 60px;
      background: var(--card-bg);
      border-top: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.5rem;
      z-index: 10;
    }
    .nav-btn {
      background: var(--paper);
      border: 1px solid var(--line);
      color: var(--ink);
      font-size: 0.9rem;
      font-weight: 600;
      padding: 0.45rem 1.15rem;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      transition: background 0.15s ease;
    }
    .nav-btn:hover:not(:disabled) {
      background: var(--paper-surface);
    }
    .nav-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .nav-btn:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }
    .nav-counter {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .progress-bar {
      position: absolute;
      top: 0;
      left: 0;
      height: 3px;
      background: var(--green-deep);
      transition: width 0.2s ease;
    }

    /* ==========================================================
       MODALIDAD 2: MOSAICO DE IDEAS (GRID)
       ========================================================== */
    #view-mosaic,
    #view-list,
    #view-analytics {
      padding: 2rem 1.5rem 4rem;
      max-width: 1240px;
      margin: 0 auto;
    }
    .view-title-header {
      margin-bottom: 1.75rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--line);
    }
    .view-title-header h2 {
      font-size: 1.6rem;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: var(--ink);
      margin-bottom: 0.35rem;
    }
    .view-title-header p {
      color: var(--muted);
      font-size: 0.95rem;
    }

    .mosaic-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.25rem;
    }
    .mosaic-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.35rem;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-sm);
      transition: box-shadow 0.15s ease, transform 0.15s ease;
    }
    .mosaic-card:hover {
      box-shadow: var(--shadow-md);
    }
    .mosaic-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.85rem;
    }
    .idea-badge-num {
      font-family: monospace;
      font-weight: 700;
      font-size: 0.85rem;
      color: var(--green-deep);
      background: rgba(49, 92, 59, 0.08);
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
    }
    .mosaic-card-body {
      font-size: 1.02rem;
      line-height: 1.55;
      color: var(--ink);
      flex: 1;
      white-space: pre-wrap;
      word-break: break-word;
      margin-bottom: 1rem;
    }
    .mosaic-card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 0.65rem;
      border-top: 1px solid var(--line);
      font-size: 0.75rem;
      color: var(--muted);
    }

    /* ==========================================================
       MODALIDAD 3: LISTADO DETALLADO (LIST)
       ========================================================== */
    .list-container {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      max-width: 960px;
      margin: 0 auto;
    }
    .list-item {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-left: 4px solid var(--green-deep);
      border-radius: 8px;
      padding: 1.15rem 1.4rem;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .list-item-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.8rem;
    }
    .list-item-num {
      font-family: monospace;
      font-weight: 800;
      color: var(--green-deep);
      font-size: 0.9rem;
    }
    .list-item-date {
      color: var(--muted);
      margin-left: auto;
    }
    .list-item-content {
      font-size: 1.05rem;
      line-height: 1.55;
      color: var(--ink);
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* ==========================================================
       MODALIDAD 4: ANÁLISIS DE RESULTADOS (ANALYTICS)
       ========================================================== */
    .analytics-container {
      display: flex;
      flex-direction: column;
      gap: 1.75rem;
    }
    .kpis-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-sm);
    }
    .kpi-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      font-weight: 700;
      margin-bottom: 0.4rem;
    }
    .kpi-value {
      font-size: 2.2rem;
      font-weight: 800;
      color: var(--green-deep);
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .kpi-value-sm {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--ink);
      line-height: 1.3;
      margin: 0.25rem 0;
    }
    .kpi-sub {
      font-size: 0.8rem;
      color: var(--muted);
      margin-top: 0.4rem;
    }

    .analytics-sections-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 1.25rem;
    }
    .analytics-section-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.5rem;
      box-shadow: var(--shadow-sm);
    }
    .analytics-section-card h3 {
      font-size: 1.15rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
      color: var(--ink);
    }
    .section-desc {
      font-size: 0.85rem;
      color: var(--muted);
      margin-bottom: 1.25rem;
    }
    .dist-bars {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .dist-row {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .dist-label-line {
      display: flex;
      justify-content: space-between;
      font-size: 0.85rem;
      color: var(--ink);
    }
    .dist-bar-track {
      height: 8px;
      background: var(--paper-surface);
      border-radius: 9999px;
      overflow: hidden;
    }
    .dist-bar-fill {
      height: 100%;
      border-radius: 9999px;
    }
    .dist-short { background: var(--green-deep); }
    .dist-med { background: #4a7c59; }
    .dist-long { background: var(--yellow); }
    .dist-pub { background: #2e7d32; }
    .dist-pend { background: #b78103; }
    .dist-hid { background: #546e7a; }

    .scope-notice {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 1rem;
      font-size: 0.9rem;
      color: var(--muted);
      line-height: 1.5;
    }

    .methodology-note {
      background: rgba(49, 92, 59, 0.05);
      border: 1px solid rgba(49, 92, 59, 0.2);
      border-radius: 8px;
      padding: 1.2rem;
    }
    .methodology-note h4 {
      font-size: 0.9rem;
      color: var(--green-deep);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.35rem;
    }
    .methodology-note p {
      font-size: 0.85rem;
      color: var(--ink-light);
      line-height: 1.5;
    }

    /* RESPONSIVE Y PREFERS-REDUCED-MOTION */
    @media (max-width: 768px) {
      .app-header {
        padding: 0.5rem 1rem;
      }
      .modes-selector {
        width: 100%;
        justify-content: space-between;
      }
      .mode-tab {
        flex: 1;
        justify-content: center;
        padding: 0.4rem 0.4rem;
        font-size: 0.78rem;
      }
      .slide {
        padding: 1.5rem 1rem;
      }
      .ideas-grid.count-2,
      .ideas-grid.count-3,
      .ideas-grid.count-4 {
        grid-template-columns: 1fr;
      }
      #view-mosaic,
      #view-list,
      #view-analytics {
        padding: 1.25rem 1rem 3rem;
      }
      .analytics-sections-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
      .progress-bar {
        transition: none !important;
      }
    }

    /* ==========================================================
       REGLAS DE IMPRESIÓN Y EXPORTACIÓN A PDF (@media print)
       ========================================================== */
    @media print {
      *,
      *::before,
      *::after {
        background: transparent !important;
        box-shadow: none !important;
        text-shadow: none !important;
      }
      body, html {
        background: #ffffff !important;
        color: #111111 !important;
        font-size: 11pt;
        line-height: 1.4;
        height: auto !important;
        min-height: auto !important;
        overflow: visible !important;
      }
      /* Ocultar cabecera persistente, selector de pestañas y barra de control de slides */
      .app-header,
      .modes-selector,
      .deck-nav,
      .progress-bar {
        display: none !important;
      }
      /* Modo Presentación: imprimir todas las ideas y diapositivas de manera secuencial */
      #view-presentation {
        height: auto !important;
        overflow: visible !important;
        display: block !important;
        position: static !important;
      }
      #view-presentation.view-hidden {
        display: none !important;
      }
      .deck-container {
        height: auto !important;
        overflow: visible !important;
        position: static !important;
      }
      #view-presentation .slide {
        position: static !important;
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
        break-after: page;
        page-break-after: always;
        padding: 2.5rem 1.5rem !important;
        min-height: auto !important;
        box-sizing: border-box;
      }
      #view-presentation .slide:last-child {
        break-after: auto;
        page-break-after: auto;
      }
      #view-presentation .slide-cover {
        display: flex !important;
        flex-direction: column !important;
        justify-content: center !important;
        min-height: 80vh;
      }
      #view-presentation .slide-header {
        border-bottom: 1px solid #cccccc !important;
        margin-bottom: 1.5rem !important;
      }
      #view-presentation .slide-body {
        max-width: 100% !important;
      }
      /* Tarjetas en todas las modalidades: evitar cortes a mitad de página */
      .idea-card,
      .mosaic-card,
      .list-item,
      .kpi-card,
      .analytics-section-card {
        border: 1px solid #d0d0d0 !important;
        background: #ffffff !important;
        break-inside: avoid;
        page-break-inside: avoid;
        box-shadow: none !important;
      }
      .idea-content,
      .mosaic-card-body,
      .list-item-content {
        color: #111111 !important;
      }
      .idea-number,
      .idea-badge-num,
      .list-item-num {
        color: #202620 !important;
      }
      /* Contenedores de mosaico, listado y análisis */
      #view-mosaic,
      #view-list,
      #view-analytics {
        max-width: 100% !important;
        padding: 1rem 0 !important;
        margin: 0 !important;
      }
      .view-title-header {
        border-bottom: 1px solid #cccccc !important;
      }
      .dist-bar-track {
        border: 1px solid #d0d0d0 !important;
      }
      .dist-bar-fill {
        background: #555555 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  </style>
</head>
<body>
  <!-- ENCABEZADO PERSISTENTE CON MARCA OFICIAL Y SELECTOR ACCESIBLE -->
  <header class="app-header">
    <div class="header-brand-group">
      <div class="brand">
        ${officialLogoSvg}
        <span class="brand-name">muro<strong>común</strong></span>
      </div>
      <span class="brand-tagline">Ideas que hacen lugar</span>
    </div>

    <nav class="modes-selector" role="tablist" aria-label="Modalidades de visualización">
      <button type="button" class="mode-tab active" id="tab-deck" role="tab" aria-selected="true" tabindex="0" aria-controls="view-presentation">
        <span>📽️</span> Presentación
      </button>
      <button type="button" class="mode-tab" id="tab-mosaic" role="tab" aria-selected="false" tabindex="-1" aria-controls="view-mosaic">
        <span>🗂️</span> Mosaico
      </button>
      <button type="button" class="mode-tab" id="tab-list" role="tab" aria-selected="false" tabindex="-1" aria-controls="view-list">
        <span>📋</span> Listado
      </button>
      <button type="button" class="mode-tab" id="tab-analytics" role="tab" aria-selected="false" tabindex="-1" aria-controls="view-analytics">
        <span>📊</span> Análisis
      </button>
    </nav>
  </header>

  <!-- MODALIDAD 1: PRESENTACIÓN (SLIDESHOW) -->
  <main class="view-panel" id="view-presentation" role="tabpanel" aria-labelledby="tab-deck">
    <div class="deck-container" id="deck-container">
      <div class="progress-bar" id="progress-bar" style="width: ${(1 / totalSlides) * 100}%;"></div>
      ${renderSlidesHtml}
    </div>
    <footer class="deck-nav" aria-label="Controles de diapositivas">
      <button type="button" class="nav-btn" id="btn-prev" aria-label="Diapositiva anterior" disabled>← Anterior</button>
      <div class="nav-counter" id="slide-counter" aria-live="polite">Diapositiva 1 de ${totalSlides}</div>
      <button type="button" class="nav-btn" id="btn-next" aria-label="Diapositiva siguiente" ${totalSlides <= 1 ? "disabled" : ""}>Siguiente →</button>
    </footer>
  </main>

  <!-- MODALIDAD 2: MOSAICO DE IDEAS (GRID) -->
  <section class="view-panel view-hidden" id="view-mosaic" role="tabpanel" aria-labelledby="tab-mosaic">
    <div class="view-title-header">
      <h2>Mosaico de ideas</h2>
      <p>${escapeHtml(activity.title)} · Código ${escapeHtml(activity.public_code)} (${ideas.length} aportes)</p>
    </div>
    ${renderMosaicHtml}
  </section>

  <!-- MODALIDAD 3: LISTADO DETALLADO (LIST) -->
  <section class="view-panel view-hidden" id="view-list" role="tabpanel" aria-labelledby="tab-list">
    <div class="view-title-header">
      <h2>Listado detallado</h2>
      <p>Visualización vertical correlativa de las ideas registradas</p>
    </div>
    ${renderListHtml}
  </section>

  <!-- MODALIDAD 4: ANÁLISIS DE RESULTADOS (ANALYTICS) -->
  <section class="view-panel view-hidden" id="view-analytics" role="tabpanel" aria-labelledby="tab-analytics">
    <div class="view-title-header">
      <h2>Análisis de resultados</h2>
      <p>Estadísticas y métricas consolidadas sobre los datos reales del reporte</p>
    </div>
    ${analyticsContentHtml}
  </section>

  <script>
    (function() {
      // 1. GESTIÓN DEL SELECTOR DE MODALIDADES
      var modes = ['deck', 'mosaic', 'list', 'analytics'];
      var tabs = {
        deck: document.getElementById('tab-deck'),
        mosaic: document.getElementById('tab-mosaic'),
        list: document.getElementById('tab-list'),
        analytics: document.getElementById('tab-analytics')
      };
      var panels = {
        deck: document.getElementById('view-presentation'),
        mosaic: document.getElementById('view-mosaic'),
        list: document.getElementById('view-list'),
        analytics: document.getElementById('view-analytics')
      };
      var currentMode = 'deck';

      function switchMode(targetMode) {
        if (!panels[targetMode] || currentMode === targetMode) return;
        currentMode = targetMode;

        for (var i = 0; i < modes.length; i++) {
          var m = modes[i];
          if (m === targetMode) {
            tabs[m].classList.add('active');
            tabs[m].setAttribute('aria-selected', 'true');
            tabs[m].setAttribute('tabindex', '0');
            panels[m].classList.remove('view-hidden');
          } else {
            tabs[m].classList.remove('active');
            tabs[m].setAttribute('aria-selected', 'false');
            tabs[m].setAttribute('tabindex', '-1');
            panels[m].classList.add('view-hidden');
          }
        }

        // Si salimos de deck, la ventana hace scroll normal
        if (targetMode !== 'deck') {
          window.scrollTo({ top: 0, behavior: 'auto' });
        }
      }

      tabs.deck.addEventListener('click', function() { switchMode('deck'); });
      tabs.mosaic.addEventListener('click', function() { switchMode('mosaic'); });
      tabs.list.addEventListener('click', function() { switchMode('list'); });
      tabs.analytics.addEventListener('click', function() { switchMode('analytics'); });

      // Navegación por teclado entre pestañas (WAI-ARIA: Flechas Izquierda/Derecha, Home, End)
      var tabListNav = document.querySelector('.modes-selector');
      var tabElements = [tabs.deck, tabs.mosaic, tabs.list, tabs.analytics];

      if (tabListNav) {
        tabListNav.addEventListener('keydown', function(e) {
          var focusedIdx = -1;
          for (var i = 0; i < tabElements.length; i++) {
            if (tabElements[i] === document.activeElement) {
              focusedIdx = i;
              break;
            }
          }
          if (focusedIdx === -1) return;

          if (e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            var nextIdx = (focusedIdx + 1) % tabElements.length;
            tabElements[nextIdx].focus();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            var prevIdx = (focusedIdx - 1 + tabElements.length) % tabElements.length;
            tabElements[prevIdx].focus();
          } else if (e.key === 'Home') {
            e.preventDefault();
            e.stopPropagation();
            tabElements[0].focus();
          } else if (e.key === 'End') {
            e.preventDefault();
            e.stopPropagation();
            tabElements[tabElements.length - 1].focus();
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            tabElements[focusedIdx].click();
          }
        });
      }

      // 2. GESTIÓN DE LA NAVEGACIÓN EN MODO PRESENTACIÓN
      var currentSlide = 1;
      var totalSlides = ${totalSlides};
      var btnPrev = document.getElementById('btn-prev');
      var btnNext = document.getElementById('btn-next');
      var counter = document.getElementById('slide-counter');
      var progressBar = document.getElementById('progress-bar');

      function updateSlide(target) {
        if (target < 1 || target > totalSlides) return;
        var prevSlide = document.getElementById('slide-' + currentSlide);
        if (prevSlide) prevSlide.classList.remove('active');

        currentSlide = target;
        var nextSlide = document.getElementById('slide-' + currentSlide);
        if (nextSlide) nextSlide.classList.add('active');

        btnPrev.disabled = currentSlide === 1;
        btnNext.disabled = currentSlide === totalSlides;
        counter.textContent = 'Diapositiva ' + currentSlide + ' de ' + totalSlides;
        progressBar.style.width = ((currentSlide / totalSlides) * 100) + '%';
      }

      btnPrev.addEventListener('click', function() { updateSlide(currentSlide - 1); });
      btnNext.addEventListener('click', function() { updateSlide(currentSlide + 1); });

      document.addEventListener('keydown', function(e) {
        if (currentMode !== 'deck') return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (e.target && e.target.closest && e.target.closest('.modes-selector')) return;
        if (e.target && e.target.getAttribute && e.target.getAttribute('role') === 'tab') return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
          e.preventDefault();
          updateSlide(currentSlide + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
          e.preventDefault();
          updateSlide(currentSlide - 1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          updateSlide(1);
        } else if (e.key === 'End') {
          e.preventDefault();
          updateSlide(totalSlides);
        }
      });
    })();
  </script>
</body>
</html>`;
}
