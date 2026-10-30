export type ExportableIdea = {
  id: string;
  content: string;
  status: "pending" | "published" | "hidden";
  created_at: string;
  published_at: string | null;
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
 * Agrupa las ideas en diapositivas adaptativas:
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
 * Genera un documento HTML autónomo, accesible, seguro y completamente offline.
 */
export function generateHtmlSlideDeck(
  activity: ExportableActivity,
  ideas: ExportableIdea[],
  scope: "published" | "all" = "published",
): string {
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

  const renderSlidesHtml = slides
    .map((slide, index) => {
      const slideNumber = index + 1;
      const isInitial = index === 0 ? "active" : "";

      if (slide.type === "cover") {
        return `
        <article class="slide slide-cover ${isInitial}" id="slide-${slideNumber}" role="region" aria-roledescription="slide" aria-label="Portada">
          <div class="cover-content">
            <div class="brand">
              <span class="brand-mark">m<span>.</span></span>
              <span>muro<strong>común</strong></span>
            </div>
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
          const statusBadge =
            scope === "all"
              ? `<span class="status-badge status-${escapeHtml(idea.status)}">${escapeHtml(STATUS_LABELS[idea.status] ?? idea.status)}</span>`
              : "";

          return `
          <div class="idea-card ${isSingle ? "idea-card-single" : ""}">
            <div class="idea-card-header">
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

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(activity.title)} — Muro Común</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --surface-border: #30363d;
      --card-bg: #21262d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --brand: #58a6ff;
      --accent: #238636;
      --status-published: #238636;
      --status-pending: #d29922;
      --status-hidden: #6e7681;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .deck-container {
      flex: 1;
      position: relative;
      width: 100%;
      height: calc(100vh - 64px);
    }
    .slide {
      position: absolute;
      inset: 0;
      padding: 3rem 4rem;
      display: none;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      overflow-y: auto;
    }
    .slide.active {
      display: flex;
    }
    .slide-cover {
      text-align: center;
    }
    .cover-content {
      max-width: 800px;
      margin: auto;
    }
    .brand {
      font-size: 1.5rem;
      letter-spacing: -0.03em;
      margin-bottom: 1.5rem;
      color: var(--text-muted);
    }
    .brand-mark {
      font-weight: 800;
      color: var(--brand);
      margin-right: 0.35rem;
    }
    .brand strong {
      color: var(--text);
    }
    .kicker {
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--brand);
      margin-bottom: 1rem;
    }
    .activity-title {
      font-size: clamp(2rem, 4vw, 3rem);
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 1rem;
    }
    .activity-question {
      font-size: clamp(1.1rem, 2vw, 1.4rem);
      color: var(--text-muted);
      margin-bottom: 2.5rem;
      line-height: 1.5;
    }
    .cover-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5rem;
      justify-content: center;
      padding-top: 1.5rem;
      border-top: 1px solid var(--surface-border);
    }
    .meta-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }
    .meta-label {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .meta-value {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text);
    }
    .slide-header {
      width: 100%;
      max-width: 1100px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--surface-border);
      font-size: 0.9rem;
      color: var(--text-muted);
    }
    .slide-tag {
      font-family: monospace;
      font-size: 0.85rem;
      background: var(--surface);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      border: 1px solid var(--surface-border);
    }
    .slide-body {
      width: 100%;
      max-width: 1100px;
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
    @media (max-width: 768px) {
      .ideas-grid.count-2,
      .ideas-grid.count-3,
      .ideas-grid.count-4 {
        grid-template-columns: 1fr;
      }
      .slide {
        padding: 1.5rem;
      }
    }
    .idea-card {
      background: var(--card-bg);
      border: 1px solid var(--surface-border);
      border-radius: 12px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }
    .idea-card-single {
      padding: 3rem;
      min-height: 280px;
      justify-content: center;
    }
    .idea-card-header {
      display: flex;
      justify-content: flex-end;
      min-height: 24px;
      margin-bottom: 0.75rem;
    }
    .idea-content {
      font-size: 1.25rem;
      line-height: 1.5;
      color: var(--text);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .idea-card-single .idea-content {
      font-size: clamp(1.4rem, 2.5vw, 2rem);
      line-height: 1.4;
      text-align: center;
    }
    .status-badge {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      letter-spacing: 0.05em;
    }
    .status-published { background: rgba(35, 134, 54, 0.2); color: #3fb950; border: 1px solid rgba(35, 134, 54, 0.4); }
    .status-pending { background: rgba(210, 153, 34, 0.2); color: #d29922; border: 1px solid rgba(210, 153, 34, 0.4); }
    .status-hidden { background: rgba(110, 118, 129, 0.2); color: #8b949e; border: 1px solid rgba(110, 118, 129, 0.4); }
    .empty-box {
      text-align: center;
      max-width: 500px;
    }
    .empty-icon {
      font-size: 3rem;
      color: var(--text-muted);
      display: block;
      margin-bottom: 1rem;
    }
    .empty-box h2 {
      margin-bottom: 0.5rem;
    }
    .empty-box p {
      color: var(--text-muted);
    }
    .deck-nav {
      height: 64px;
      background: var(--surface);
      border-top: 1px solid var(--surface-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 2rem;
      z-index: 10;
    }
    .nav-btn {
      background: var(--card-bg);
      border: 1px solid var(--surface-border);
      color: var(--text);
      font-size: 0.95rem;
      font-weight: 600;
      padding: 0.5rem 1.25rem;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }
    .nav-btn:hover:not(:disabled) {
      background: var(--surface-border);
    }
    .nav-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .nav-btn:focus-visible {
      outline: 2px solid var(--brand);
      outline-offset: 2px;
    }
    .nav-counter {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .progress-bar {
      position: absolute;
      top: 0;
      left: 0;
      height: 3px;
      background: var(--brand);
      transition: width 0.2s ease;
    }
    @media (prefers-reduced-motion: reduce) {
      .progress-bar {
        transition: none;
      }
    }
  </style>
</head>
<body>
  <div class="deck-container" id="deck-container">
    <div class="progress-bar" id="progress-bar" style="width: ${(1 / totalSlides) * 100}%;"></div>
    ${renderSlidesHtml}
  </div>
  <footer class="deck-nav" aria-label="Controles de diapositivas">
    <button type="button" class="nav-btn" id="btn-prev" aria-label="Diapositiva anterior" disabled>← Anterior</button>
    <div class="nav-counter" id="slide-counter" aria-live="polite">Diapositiva 1 de ${totalSlides}</div>
    <button type="button" class="nav-btn" id="btn-next" aria-label="Diapositiva siguiente" ${totalSlides <= 1 ? "disabled" : ""}>Siguiente →</button>
  </footer>

  <script>
    (function() {
      var current = 1;
      var total = ${totalSlides};
      var btnPrev = document.getElementById('btn-prev');
      var btnNext = document.getElementById('btn-next');
      var counter = document.getElementById('slide-counter');
      var progressBar = document.getElementById('progress-bar');

      function updateSlide(target) {
        if (target < 1 || target > total) return;
        var prevSlide = document.getElementById('slide-' + current);
        if (prevSlide) prevSlide.classList.remove('active');

        current = target;
        var nextSlide = document.getElementById('slide-' + current);
        if (nextSlide) nextSlide.classList.add('active');

        btnPrev.disabled = current === 1;
        btnNext.disabled = current === total;
        counter.textContent = 'Diapositiva ' + current + ' de ' + total;
        progressBar.style.width = ((current / total) * 100) + '%';
      }

      btnPrev.addEventListener('click', function() { updateSlide(current - 1); });
      btnNext.addEventListener('click', function() { updateSlide(current + 1); });

      document.addEventListener('keydown', function(e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
          e.preventDefault();
          updateSlide(current + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
          e.preventDefault();
          updateSlide(current - 1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          updateSlide(1);
        } else if (e.key === 'End') {
          e.preventDefault();
          updateSlide(total);
        }
      });
    })();
  </script>
</body>
</html>`;
}
