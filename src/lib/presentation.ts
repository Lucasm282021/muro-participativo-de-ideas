import type { Idea } from "@/lib/types";

export const MAX_WALL_CARDS = 48;
export const HOLD_DURATION_MS = 8000;
export const TRANSITION_DURATION_MS = 700;
export const BATCH_CAP = 100;
export const RESYNC_INTERVAL_MS = 60000;
export const NULL_MARKER = "__NULL_MARKER__";

export type FeaturedPhase = "holding" | "transitioning";

export interface FeaturedItem {
  idea: Idea;
  phase: FeaturedPhase;
}

export interface Cursor {
  createdAt: string;
  id: string;
}

export interface PresentationState {
  wall: Idea[];
  queue: Idea[];
  featured: FeaturedItem | null;
}

/**
 * Deriva determinísticamente una variante visual (0..4) para una idea
 * usando el hash de su id. Permanece pura e inmutable durante todo el ciclo.
 */
export function getCardVariant(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 5;
}

/**
 * Comparador FIFO estricto: (created_at ASC, id ASC).
 * Utiliza comparación directa de cadenas ISO-8601 e IDs (sin localeCompare).
 */
export function compareIdeasFIFO(
  a: { created_at: string; id: string },
  b: { created_at: string; id: string },
): number {
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? -1 : 1;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }
  return 0;
}

/**
 * Compara una idea con un Cursor:
 * Retorna negativo si idea < cursor, 0 si son iguales, positivo si idea > cursor.
 */
export function compareIdeaWithCursor(
  idea: { created_at: string; id: string },
  cursor: Cursor,
): number {
  if (idea.created_at !== cursor.createdAt) {
    return idea.created_at < cursor.createdAt ? -1 : 1;
  }
  if (idea.id !== cursor.id) {
    return idea.id < cursor.id ? -1 : 1;
  }
  return 0;
}

/**
 * Comprueba si una idea es estrictamente posterior a un cursor.
 */
export function isAfterCursor(
  idea: { created_at: string; id: string },
  cursor: Cursor | null,
): boolean {
  if (!cursor) return true;
  return compareIdeaWithCursor(idea, cursor) > 0;
}

/**
 * Avanza el cursor de manera monótona: max(current, candidate).
 */
export function maxCursor(
  current: Cursor | null,
  candidate: { created_at: string; id: string },
): Cursor {
  if (!current) {
    return { createdAt: candidate.created_at, id: candidate.id };
  }
  if (compareIdeaWithCursor(candidate, current) > 0) {
    return { createdAt: candidate.created_at, id: candidate.id };
  }
  return current;
}

/**
 * Encuentra el elemento máximo (último en tiempo/id) en un conjunto de ideas.
 */
export function findMaxIdea(ideas: Idea[]): Cursor | null {
  if (ideas.length === 0) return null;
  let max = ideas[0];
  for (let i = 1; i < ideas.length; i++) {
    if (compareIdeasFIFO(ideas[i], max) > 0) {
      max = ideas[i];
    }
  }
  return { createdAt: max.created_at, id: max.id };
}

/**
 * Encola ideas publicadas descartando las ya conocidas.
 * Mantiene la cola ordenada por FIFO (created_at ASC, id ASC).
 * No descarta ideas ni tiene límite de tamaño.
 */
export function enqueueIdeas(
  currentQueue: Idea[],
  newIdeas: Idea[],
  existingIds: Set<string>,
): Idea[] {
  const fresh = newIdeas.filter(
    (idea) => idea.status === "published" && !existingIds.has(idea.id),
  );
  if (fresh.length === 0) return currentQueue;

  const combined = [...currentQueue, ...fresh];
  const seen = new Set<string>();
  const deduped: Idea[] = [];
  for (const item of combined) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      deduped.push(item);
    }
  }
  return deduped.sort(compareIdeasFIFO);
}

/**
 * Extrae la siguiente idea de la cola FIFO e inicia su fase "holding".
 */
export function startNextFeatured(queue: Idea[]): {
  nextFeatured: FeaturedItem | null;
  remainingQueue: Idea[];
} {
  if (queue.length === 0) {
    return { nextFeatured: null, remainingQueue: [] };
  }
  const [first, ...remaining] = queue;
  return {
    nextFeatured: { idea: first, phase: "holding" },
    remainingQueue: remaining,
  };
}

/**
 * Avanza la fase de la idea destacada de "holding" a "transitioning".
 */
export function transitionFeatured(
  featured: FeaturedItem | null,
): FeaturedItem | null {
  if (!featured || featured.phase === "transitioning") return featured;
  return { ...featured, phase: "transitioning" };
}

/**
 * Concluye la presentación de la idea destacada agregándola al muro (máximo N=48).
 */
export function completeFeatured(
  wall: Idea[],
  featured: FeaturedItem | null,
  maxWallSize = MAX_WALL_CARDS,
): Idea[] {
  if (!featured) return wall;
  const filtered = wall.filter((w) => w.id !== featured.idea.id);
  return [featured.idea, ...filtered].slice(0, maxWallSize);
}

/**
 * Remueve una idea de todos los estados (cola, muro y destacada).
 * Si la idea estaba en featured, señala interrupción para cancelar timers.
 */
export function removeIdea(
  state: PresentationState,
  ideaId: string,
): { nextState: PresentationState; interrupted: boolean } {
  const interrupted = state.featured?.idea.id === ideaId;
  return {
    nextState: {
      wall: state.wall.filter((i) => i.id !== ideaId),
      queue: state.queue.filter((i) => i.id !== ideaId),
      featured: interrupted ? null : state.featured,
    },
    interrupted,
  };
}

/**
 * Purga de forma segura ideas moderadas basadas únicamente en las IDs
 * que fueron consultadas activamente. Si la query falló, activeIdsQueried
 * es vacío y nada se purga.
 */
export function purgeModeratedIdeas(
  state: PresentationState,
  activeIdsQueried: string[],
  confirmedPublishedIds: Set<string>,
): { nextState: PresentationState; interrupted: boolean } {
  if (activeIdsQueried.length === 0) {
    return { nextState: state, interrupted: false };
  }

  const queriedSet = new Set(activeIdsQueried);
  const isModerated = (id: string) =>
    queriedSet.has(id) && !confirmedPublishedIds.has(id);

  const interrupted = Boolean(
    state.featured && isModerated(state.featured.idea.id),
  );
  const nextFeatured = interrupted ? null : state.featured;

  return {
    nextState: {
      wall: state.wall.filter((i) => !isModerated(i.id)),
      queue: state.queue.filter((i) => !isModerated(i.id)),
      featured: nextFeatured,
    },
    interrupted,
  };
}

/**
 * Gestión de la clave y persistencia del cursor en sessionStorage (v2).
 */
export function getCursorStorageKey(activityCode: string): string {
  return `muro_cursor2_${activityCode.toUpperCase()}`;
}

export function readStoredCursor(
  storage: Storage | null,
  activityCode: string,
): { exists: boolean; cursor: Cursor | null } {
  if (!storage) return { exists: false, cursor: null };
  try {
    const raw = storage.getItem(getCursorStorageKey(activityCode));
    if (raw === null) return { exists: false, cursor: null };
    if (raw === NULL_MARKER) return { exists: true, cursor: null };
    const parsed = JSON.parse(raw) as Cursor;
    if (
      parsed &&
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string"
    ) {
      return { exists: true, cursor: parsed };
    }
    return { exists: true, cursor: null };
  } catch {
    return { exists: false, cursor: null };
  }
}

export function persistCursor(
  storage: Storage | null,
  activityCode: string,
  cursor: Cursor | null,
): void {
  if (!storage) return;
  try {
    const key = getCursorStorageKey(activityCode);
    if (cursor === null) {
      storage.setItem(key, NULL_MARKER);
    } else {
      storage.setItem(key, JSON.stringify(cursor));
    }
  } catch {
    // Modo privado o cuota excedida
  }
}
