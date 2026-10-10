"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BATCH_CAP,
  type Cursor,
  compareIdeasFIFO,
  compareIdeaWithCursor,
  completeFeatured,
  enqueueIdeas,
  type FeaturedItem,
  findMaxIdea,
  getCardVariant,
  HOLD_DURATION_MS,
  isAfterCursor,
  MAX_WALL_CARDS,
  maxCursor,
  type PresentationState,
  persistCursor,
  purgeModeratedIdeas,
  RESYNC_INTERVAL_MS,
  readStoredCursor,
  removeIdea,
  startNextFeatured,
  TRANSITION_DURATION_MS,
  transitionFeatured,
} from "@/lib/presentation";
import { createClient } from "@/lib/supabase/client";
import type { Idea } from "@/lib/types";

function getGridConfig(
  count: number,
  containerWidth: number,
  containerHeight: number,
): { cols: number; rows: number } {
  if (count <= 0) return { cols: 1, rows: 1 };

  const aspect =
    containerWidth > 0 && containerHeight > 0
      ? containerWidth / containerHeight
      : 1.8;

  const isWide = aspect >= 1.2;

  if (isWide) {
    if (count === 1) return { cols: 1, rows: 1 };
    if (count === 2) return { cols: 2, rows: 1 };
    if (count === 3) return { cols: 2, rows: 2 };
    if (count === 4) return { cols: 2, rows: 2 };
    if (count <= 6) return { cols: 3, rows: 2 };
    if (count <= 8) return { cols: 4, rows: 2 };
    if (count === 9) return { cols: 3, rows: 3 };
    if (count <= 12) return { cols: 4, rows: 3 };
    if (count <= 16) return { cols: 4, rows: 4 };
    if (count <= 20) return { cols: 5, rows: 4 };
    if (count <= 24) return { cols: 6, rows: 4 };
    if (count <= 30) return { cols: 6, rows: 5 };
    if (count <= 36) return { cols: 6, rows: 6 };
    if (count <= 42) return { cols: 7, rows: 6 };
    return { cols: 8, rows: 6 };
  } else {
    if (count === 1) return { cols: 1, rows: 1 };
    if (count === 2) return { cols: 1, rows: 2 };
    if (count <= 4) return { cols: 2, rows: 2 };
    if (count <= 6) return { cols: 2, rows: 3 };
    if (count <= 8) return { cols: 2, rows: 4 };
    if (count <= 12) return { cols: 3, rows: 4 };
    if (count <= 16) return { cols: 4, rows: 4 };
    if (count <= 20) return { cols: 4, rows: 5 };
    if (count <= 24) return { cols: 4, rows: 6 };
    if (count <= 30) return { cols: 5, rows: 6 };
    if (count <= 36) return { cols: 6, rows: 6 };
    if (count <= 42) return { cols: 6, rows: 7 };
    return { cols: 6, rows: 8 };
  }
}

function getWideIdeaIds(ideas: Idea[], totalSlots: number): Set<string> {
  const extraSlots = totalSlots - ideas.length;
  if (extraSlots <= 0 || ideas.length === 0) return new Set();

  const sorted = [...ideas].sort(
    (a, b) => b.content.trim().length - a.content.trim().length,
  );
  const wideSet = new Set<string>();
  for (let i = 0; i < extraSlots && i < sorted.length; i++) {
    wideSet.add(sorted[i].id);
  }
  return wideSet;
}

function calculateCardTypography(
  content: string,
  cardWidth: number,
  cardHeight: number,
): { fontSize: string; lineClamp: number } {
  const charCount = Math.max(content.trim().length, 1);
  const availableWidth = Math.max(cardWidth - 28, 60);
  const availableHeight = Math.max(cardHeight - 44, 30);

  const maxByCard = Math.max(13, Math.floor(availableHeight * 0.18));
  const maxByWidth = Math.max(13, Math.floor(availableWidth / 9));
  const maxFontSize = Math.min(34, maxByCard, maxByWidth);
  const minFontSize = 11;

  const rawIdeal = Math.sqrt(
    (availableWidth * availableHeight) / (charCount * 0.72),
  );

  let finalFontSize = Math.min(
    maxFontSize,
    Math.max(minFontSize, Math.round(rawIdeal * 2) / 2),
  );

  const charsPerLine = Math.max(
    8,
    Math.floor(availableWidth / (finalFontSize * 0.58)),
  );
  const estimatedLines = Math.ceil(charCount / charsPerLine);
  const lineHeight = finalFontSize * 1.34;
  const totalTextHeight = estimatedLines * lineHeight;

  if (totalTextHeight > availableHeight && finalFontSize > minFontSize) {
    finalFontSize = Math.max(
      minFontSize,
      Math.round((availableHeight / (estimatedLines * 1.34)) * 2) / 2,
    );
  }

  const lineClamp = Math.max(
    1,
    Math.floor(availableHeight / (finalFontSize * 1.34)),
  );

  return {
    fontSize: `${finalFontSize}px`,
    lineClamp,
  };
}

export function LiveWall({
  activityId,
  publicCode,
  title,
  question,
  initialIdeas,
  initialJoinUrl,
}: {
  activityId: string;
  publicCode: string;
  title: string;
  question: string;
  initialIdeas: Idea[];
  initialJoinUrl?: string;
}) {
  const [wall, setWall] = useState<Idea[]>(() =>
    initialIdeas.slice(0, MAX_WALL_CARDS),
  );
  const [queue, setQueue] = useState<Idea[]>([]);
  const [featured, setFeatured] = useState<FeaturedItem | null>(null);
  const [joinUrl, setJoinUrl] = useState(initialJoinUrl || "");

  const stateRef = useRef<PresentationState>({
    wall: initialIdeas.slice(0, MAX_WALL_CARDS),
    queue: [],
    featured: null,
  });

  const cursorRef = useRef<Cursor | null>(null);
  const watermarkRef = useRef<Cursor | null>(null);

  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  }>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const container = gridContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize((prev) => {
            if (prev.width === width && prev.height === height) return prev;
            return { width, height };
          });
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPromotingRef = useRef<boolean>(false);
  const inFlightRef = useRef<boolean>(false);
  const pendingRerunRef = useRef<boolean>(false);

  const clearPresentationTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Declaración diferida de requestReconcile mediante ref para romper ciclos con promoteNext
  const requestReconcileRef = useRef<() => void>(() => {});

  const promoteNext = useCallback(async () => {
    if (isPromotingRef.current) return;
    if (stateRef.current.featured !== null) return;

    if (stateRef.current.queue.length === 0) {
      // Estado IDLE: activar resync como indica la sección 13
      requestReconcileRef.current();
      return;
    }

    isPromotingRef.current = true;

    // Catch-up antes de promoción: mientras watermark < head, descubrir contiguamente
    while (true) {
      const currentHead = stateRef.current.queue[0];
      if (!currentHead) break;

      const currentWm = watermarkRef.current;
      // Si watermark ya cubre o supera la cabeza (watermark >= head), el catch-up está completo
      if (currentWm && compareIdeaWithCursor(currentHead, currentWm) <= 0) {
        break;
      }

      let catchUpFailed = false;
      try {
        const supabase = createClient();
        let catchUpQuery = supabase
          .from("ideas")
          .select("id, activity_id, content, status, created_at, published_at")
          .eq("activity_id", activityId)
          .eq("status", "published")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(BATCH_CAP);

        if (currentWm) {
          catchUpQuery = catchUpQuery.or(
            `created_at.gt.${currentWm.createdAt},and(created_at.eq.${currentWm.createdAt},id.gt.${currentWm.id})`,
          );
        }

        const { data: catchUpData, error: catchUpError } = await catchUpQuery;
        if (catchUpError || !catchUpData) {
          catchUpFailed = true;
        } else {
          const catchUpIdeas = catchUpData as Idea[];
          if (catchUpIdeas.length === 0) {
            break;
          }

          const lastCaught = catchUpIdeas[catchUpIdeas.length - 1];
          watermarkRef.current = {
            createdAt: lastCaught.created_at,
            id: lastCaught.id,
          };

          const fresh = stateRef.current;
          const activeIds = new Set<string>();
          for (const item of fresh.wall) activeIds.add(item.id);
          for (const item of fresh.queue) activeIds.add(item.id);
          if (fresh.featured) activeIds.add(fresh.featured.idea.id);

          const updatedQueue = enqueueIdeas(
            fresh.queue,
            catchUpIdeas,
            activeIds,
          );
          stateRef.current.queue = updatedQueue;
          setQueue(updatedQueue);

          if (catchUpIdeas.length < BATCH_CAP) {
            break;
          }
        }
      } catch {
        catchUpFailed = true;
      }

      if (catchUpFailed) {
        break;
      }
    }

    // Verificar si la cola aún tiene elementos tras el catch-up
    if (stateRef.current.queue.length === 0) {
      isPromotingRef.current = false;
      requestReconcileRef.current();
      return;
    }

    const nextCandidate = stateRef.current.queue[0];

    // Validación de featured: guardFeatured(id) (Sección 11)
    let isApproved = true;
    try {
      const supabase = createClient();
      const { data: verified, error: verifyError } = await supabase
        .from("ideas")
        .select("id, status")
        .eq("id", nextCandidate.id)
        .maybeSingle();

      if (!verifyError) {
        if (verified?.status !== "published") {
          isApproved = false;
        }
      }
    } catch {
      // Error de red puntual: no bloquear presentación, cursor no avanzará si watermark no cubre
    }

    if (!isApproved) {
      // Idea moderada/eliminada en cola profunda: remover y pasar a la siguiente
      const remaining = stateRef.current.queue.filter(
        (i) => i.id !== nextCandidate.id,
      );
      stateRef.current.queue = remaining;
      setQueue(remaining);
      isPromotingRef.current = false;
      void promoteNext();
      return;
    }

    // Promoción a featured
    const { nextFeatured, remainingQueue } = startNextFeatured(
      stateRef.current.queue,
    );
    stateRef.current.queue = remainingQueue;
    stateRef.current.featured = nextFeatured;
    setQueue(remainingQueue);
    setFeatured(nextFeatured);
    isPromotingRef.current = false;

    if (!nextFeatured) {
      requestReconcileRef.current();
      return;
    }

    // Ciclo de presentación: HOLD 8s -> TRANSICIÓN 700ms -> COMPLETION
    clearPresentationTimer();
    timerRef.current = setTimeout(() => {
      setFeatured((prev) => {
        const next = transitionFeatured(prev);
        stateRef.current.featured = next;
        return next;
      });

      timerRef.current = setTimeout(() => {
        clearPresentationTimer();
        const completed = stateRef.current.featured;
        if (!completed) return;

        // 1. Mover al muro
        const nextWall = completeFeatured(
          stateRef.current.wall,
          completed,
          MAX_WALL_CARDS,
        );
        stateRef.current.wall = nextWall;
        stateRef.current.featured = null;
        setWall(nextWall);
        setFeatured(null);

        // 2. Avanzar cursor SOLO SI watermark >= completed.idea (I5)
        const currentWm = watermarkRef.current;
        if (
          currentWm &&
          compareIdeaWithCursor(completed.idea, currentWm) <= 0
        ) {
          const newCursor = maxCursor(cursorRef.current, completed.idea);
          cursorRef.current = newCursor;
          persistCursor(sessionStorage, publicCode, newCursor);
        }

        // 3. Siguiente idea o idle
        void promoteNext();
      }, TRANSITION_DURATION_MS);
    }, HOLD_DURATION_MS);
  }, [activityId, publicCode, clearPresentationTimer]);

  const executeReconcile = useCallback(async () => {
    try {
      const supabase = createClient();
      const currentWm = watermarkRef.current ?? cursorRef.current;

      // 1. Discovery lexicográfico con limit(100) (Sección 8.2)
      let discoverQuery = supabase
        .from("ideas")
        .select("id, activity_id, content, status, created_at, published_at")
        .eq("activity_id", activityId)
        .eq("status", "published")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(BATCH_CAP);

      if (currentWm) {
        discoverQuery = discoverQuery.or(
          `created_at.gt.${currentWm.createdAt},and(created_at.eq.${currentWm.createdAt},id.gt.${currentWm.id})`,
        );
      }

      // 2. Moderación acotada a wall + featured (máximo 49 IDs, Sección 11)
      const snapshot = stateRef.current;
      const activeIdsToCheck: string[] = [];
      if (snapshot.featured) {
        activeIdsToCheck.push(snapshot.featured.idea.id);
      }
      for (const w of snapshot.wall) {
        if (activeIdsToCheck.length < 49) {
          activeIdsToCheck.push(w.id);
        }
      }

      let moderationQuery = null;
      if (activeIdsToCheck.length > 0) {
        moderationQuery = supabase
          .from("ideas")
          .select("id, status")
          .in("id", activeIdsToCheck)
          .eq("status", "published");
      }

      const [discoverResult, moderationResult] = await Promise.all([
        discoverQuery,
        moderationQuery
          ? moderationQuery
          : Promise.resolve({ data: [], error: null }),
      ]);

      // FRESH SNAPSHOT (I8, CA-1)
      const fresh = stateRef.current;

      // Procesar Discovery solo si no hubo error
      let discoveredIdeas: Idea[] = [];
      if (!discoverResult.error && discoverResult.data) {
        discoveredIdeas = discoverResult.data as Idea[];
        if (discoveredIdeas.length > 0) {
          const lastDiscovered = discoveredIdeas[discoveredIdeas.length - 1];
          watermarkRef.current = {
            createdAt: lastDiscovered.created_at,
            id: lastDiscovered.id,
          };
        }
      }

      // Procesar Moderación solo si la consulta tuvo éxito (I7: Error ≠ Vacío)
      let purgedState = fresh;
      let featuredInterrupted = false;
      if (moderationQuery && !moderationResult.error && moderationResult.data) {
        const confirmedIds = new Set(
          (moderationResult.data as { id: string }[]).map((r) => r.id),
        );
        const res = purgeModeratedIdeas(fresh, activeIdsToCheck, confirmedIds);
        purgedState = res.nextState;
        featuredInterrupted = res.interrupted;
      }

      // Incorporar ideas descubiertas en la cola fresca sin duplicados
      const activeIds = new Set<string>();
      for (const item of purgedState.wall) activeIds.add(item.id);
      for (const item of purgedState.queue) activeIds.add(item.id);
      if (purgedState.featured) activeIds.add(purgedState.featured.idea.id);

      const updatedQueue = enqueueIdeas(
        purgedState.queue,
        discoveredIdeas,
        activeIds,
      );

      stateRef.current = {
        wall: purgedState.wall,
        queue: updatedQueue,
        featured: purgedState.featured,
      };
      setWall(purgedState.wall);
      setQueue(updatedQueue);
      setFeatured(purgedState.featured);

      if (featuredInterrupted) {
        clearPresentationTimer();
        void promoteNext();
      } else if (!purgedState.featured && updatedQueue.length > 0) {
        void promoteNext();
      } else if (!purgedState.featured && updatedQueue.length === 0) {
        // Si el batch vino lleno (100), podría haber más ideas pendientes en DB
        if (discoveredIdeas.length === BATCH_CAP) {
          pendingRerunRef.current = true;
        }
      }
    } catch {
      // Error silencioso: no purga ni altera estado (I7)
    }
  }, [activityId, clearPresentationTimer, promoteNext]);

  // Single-flight + pending rerun (Sección 10.1, I9)
  const requestReconcile = useCallback(() => {
    if (inFlightRef.current) {
      pendingRerunRef.current = true;
      return;
    }
    inFlightRef.current = true;

    const run = async () => {
      try {
        await executeReconcile();
      } finally {
        inFlightRef.current = false;
        if (pendingRerunRef.current) {
          pendingRerunRef.current = false;
          requestReconcile();
        }
      }
    };

    void run();
  }, [executeReconcile]);

  // Sincronizar la ref de requestReconcile
  useEffect(() => {
    requestReconcileRef.current = requestReconcile;
  }, [requestReconcile]);

  const handleNewIdea = useCallback(
    (idea: Idea) => {
      // Realtime sólo encola. NO modifica cursor ni watermark (I4, CA-11)
      const fresh = stateRef.current;
      const activeIds = new Set<string>();
      for (const item of fresh.wall) activeIds.add(item.id);
      for (const item of fresh.queue) activeIds.add(item.id);
      if (fresh.featured) activeIds.add(fresh.featured.idea.id);

      const updatedQueue = enqueueIdeas(fresh.queue, [idea], activeIds);
      stateRef.current.queue = updatedQueue;
      setQueue(updatedQueue);

      if (!fresh.featured) {
        void promoteNext();
      }
    },
    [promoteNext],
  );

  const handleRemoveIdea = useCallback(
    (ideaId: string) => {
      const fresh = stateRef.current;
      const { nextState, interrupted } = removeIdea(fresh, ideaId);

      stateRef.current = nextState;
      setWall(nextState.wall);
      setQueue(nextState.queue);
      setFeatured(nextState.featured);

      if (interrupted) {
        clearPresentationTimer();
        void promoteNext();
      }
    },
    [clearPresentationTimer, promoteNext],
  );

  // Inicialización de punto cero y recarga (Secciones 3.1, 6)
  useEffect(() => {
    setJoinUrl(`${window.location.origin}/a/${publicCode}`);

    const stored = readStoredCursor(sessionStorage, publicCode);
    if (!stored.exists) {
      // Primera apertura: Punto cero (sin catch-up histórico)
      if (initialIdeas.length > 0) {
        const maxInit = findMaxIdea(initialIdeas);
        cursorRef.current = maxInit;
        watermarkRef.current = maxInit;
        persistCursor(sessionStorage, publicCode, maxInit);
        const baseline = initialIdeas.slice(0, MAX_WALL_CARDS);
        stateRef.current.wall = baseline;
        setWall(baseline);
      } else {
        cursorRef.current = null;
        watermarkRef.current = null;
        persistCursor(sessionStorage, publicCode, null); // Guarda NULL_MARKER
        stateRef.current.wall = [];
        setWall([]);
      }
    } else {
      // Recarga de pestaña (H-03): ideas posteriores al cursor son elegibles para presentación
      cursorRef.current = stored.cursor;
      watermarkRef.current = stored.cursor;

      if (stored.cursor) {
        const baseline = initialIdeas.filter(
          (i) => !isAfterCursor(i, stored.cursor),
        );
        const pendingFromInitial = initialIdeas.filter((i) =>
          isAfterCursor(i, stored.cursor),
        );

        const initialWall = baseline.slice(0, MAX_WALL_CARDS);
        const initialQueue = pendingFromInitial.sort(compareIdeasFIFO);

        stateRef.current.wall = initialWall;
        stateRef.current.queue = initialQueue;
        setWall(initialWall);
        setQueue(initialQueue);
      } else {
        // NULL_MARKER previo: todas las iniciales son posteriores al punto cero
        stateRef.current.wall = [];
        stateRef.current.queue = initialIdeas.slice().sort(compareIdeasFIFO);
        setWall([]);
        setQueue(initialIdeas.slice().sort(compareIdeasFIFO));
      }

      // Reconcile inmediato tras recarga
      requestReconcile();
      if (stateRef.current.queue.length > 0) {
        void promoteNext();
      }
    }
  }, [publicCode, initialIdeas, requestReconcile, promoteNext]);

  // Suscripción Realtime, resync al SUBSCRIBED y resync periódico (60s)
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`ideas:${activityId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ideas",
          filter: `activity_id=eq.${activityId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            handleRemoveIdea(payload.old.id);
            return;
          }
          const idea = payload.new as Idea;
          if (idea.status === "published") {
            handleNewIdea(idea);
          } else {
            handleRemoveIdea(idea.id);
          }
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          requestReconcile();
        }
      });

    const resyncInterval = setInterval(() => {
      requestReconcile();
    }, RESYNC_INTERVAL_MS);

    return () => {
      clearInterval(resyncInterval);
      clearPresentationTimer();
      void supabase.removeChannel(channel);
    };
  }, [
    activityId,
    clearPresentationTimer,
    handleNewIdea,
    handleRemoveIdea,
    requestReconcile,
  ]);

  const gridGeometry = getGridConfig(
    wall.length,
    containerSize.width,
    containerSize.height,
  );
  const wideSet = getWideIdeaIds(wall, gridGeometry.cols * gridGeometry.rows);
  const gap = 8;
  const cols = Math.max(gridGeometry.cols, 1);
  const rows = Math.max(gridGeometry.rows, 1);
  const cellWidth =
    containerSize.width > 0
      ? (containerSize.width - gap * (cols - 1)) / cols
      : 200;
  const cellHeight =
    containerSize.height > 0
      ? (containerSize.height - gap * (rows - 1)) / rows
      : 150;

  return (
    <main className="wall-page">
      <header className="wall-header">
        <div className="brand brand-dark">
          <span className="brand-mark">
            m<span>.</span>
          </span>
          <span>
            muro<span className="brand-light">común</span>
          </span>
        </div>
        <div className="wall-live">
          <span className="live-dot" /> EN VIVO
        </div>
      </header>
      <section className="wall-intro">
        <div className="eyebrow">IDEAS QUE HACEN LUGAR</div>
        <h1>{title}</h1>
        <p>{question}</p>
      </section>
      <div className="wall-content">
        <section
          className="idea-grid-column"
          aria-live="polite"
          aria-label="Ideas publicadas"
        >
          {featured && (
            <div className="featured-spotlight">
              <article
                className={`featured-card idea-card-${getCardVariant(
                  featured.idea.id,
                )} ${
                  featured.phase === "transitioning"
                    ? "featured-transitioning"
                    : ""
                }`}
                key={featured.idea.id}
                aria-label="Idea destacada"
              >
                <div className="featured-header">
                  <span className="featured-badge">
                    <span className="featured-badge-dot" /> NUEVA IDEA
                  </span>
                  {queue.length > 0 && (
                    <span className="featured-queue-counter">
                      +{queue.length} en espera
                    </span>
                  )}
                </div>
                <p>{featured.idea.content}</p>
                <div className="featured-footer">
                  <span className="idea-number">
                    {new Intl.DateTimeFormat("es-AR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "America/Argentina/Buenos_Aires",
                    }).format(new Date(featured.idea.created_at))}
                  </span>
                </div>
                {featured.phase === "holding" && (
                  <div className="featured-progress-bar" />
                )}
              </article>
            </div>
          )}

          {wall.length ? (
            <div
              className="idea-grid"
              ref={gridContainerRef}
              style={
                {
                  "--grid-cols": gridGeometry.cols,
                  "--grid-rows": gridGeometry.rows,
                } as React.CSSProperties
              }
            >
              {wall.map((idea) => {
                const isWide = wideSet.has(idea.id);
                const actualCardWidth = isWide ? cellWidth * 2 + gap : cellWidth;
                const cardTypo = calculateCardTypography(
                  idea.content,
                  actualCardWidth,
                  cellHeight,
                );
                return (
                  <article
                    className={`idea-card idea-card-${getCardVariant(
                      idea.id,
                    )} ${isWide ? "idea-card-wide" : ""}`}
                    key={idea.id}
                    style={
                      {
                        "--card-font-size": cardTypo.fontSize,
                        "--card-line-clamp": cardTypo.lineClamp,
                      } as React.CSSProperties
                    }
                  >
                    <span className="idea-number">
                      {new Intl.DateTimeFormat("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Argentina/Buenos_Aires",
                      }).format(new Date(idea.created_at))}
                    </span>
                    <p>{idea.content}</p>
                  </article>
                );
              })}
            </div>
          ) : !featured ? (
            <div className="empty-wall">
              <span className="empty-spark">✳</span>
              <h2>Este muro empieza con vos.</h2>
              <p>Escaneá el código y compartí la primera idea.</p>
            </div>
          ) : null}
        </section>
        <aside className="wall-join-card">
          <div className="eyebrow">PARTICIPÁ</div>
          <h2>Tu voz también suma.</h2>
          <p>Escaneá el código con tu celular para dejar una idea.</p>
          {joinUrl && (
            <div className="qr-frame">
              <QRCodeSVG
                value={joinUrl}
                size={144}
                level="H"
                marginSize={4}
                title="Código QR para participar"
                imageSettings={{
                  src: "/muro-mark.svg",
                  width: 28,
                  height: 28,
                  excavate: true,
                  crossOrigin: "anonymous",
                }}
              />
            </div>
          )}
          <div className="join-code">
            <span>CÓDIGO DE ACTIVIDAD</span>
            <strong>{publicCode}</strong>
          </div>
        </aside>
      </div>
      <footer className="wall-footer">
        <span>Las ideas se muestran sin nombre.</span>
        <span>Una conversación abierta.</span>
      </footer>
    </main>
  );
}
