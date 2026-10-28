"use client";

import { AboutModal } from "@/components/about-modal";
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
    // Dimensiones objetivo para tarjetas de tamaño natural en escritorio/proyector (260-320px ancho, 160-220px alto)
    const targetWidth = 285;
    const targetHeight = 185;
    const gap = 8;

    const baseCols =
      containerWidth > 0
        ? Math.max(2, Math.min(6, Math.floor((containerWidth + gap) / (targetWidth + gap))))
        : 4;
    const baseRows =
      containerHeight > 0
        ? Math.max(2, Math.min(5, Math.floor((containerHeight + gap) / (targetHeight + gap))))
        : 4;

    const naturalCapacity = baseCols * baseRows;

    // Llenado progresivo en baja y media densidad:
    // La grilla mantiene columnas y filas estables según la pantalla para que las tarjetas
    // no se deformen ni se expandan a pantalla completa cuando hay pocas ideas.
    if (count <= naturalCapacity) {
      return { cols: baseCols, rows: baseRows };
    }

    // Alta densidad con prioridad de legibilidad (máximo 6 cols x 5 filas por viewport):
    if (count <= 24) return { cols: Math.max(baseCols, 6), rows: 4 };
    if (count <= 30) return { cols: Math.max(baseCols, 6), rows: 5 };
    // Con más de 30 ideas, se preserva el ancho legible de 6 columnas y las filas crecen
    // con altura cómoda (~160px) con desplazamiento suave, sin truncar texto en 3 líneas:
    const maxCols = Math.max(baseCols, 6);
    const scrollRows = Math.ceil(count / maxCols);
    return { cols: maxCols, rows: scrollRows };
  } else {
    // Pantallas verticales (portrait / mobile / tablets)
    const targetWidth = 240;
    const targetHeight = 160;
    const gap = 8;

    const baseCols =
      containerWidth > 0
        ? Math.max(2, Math.min(4, Math.floor((containerWidth + gap) / (targetWidth + gap))))
        : 2;
    const baseRows =
      containerHeight > 0
        ? Math.max(3, Math.min(6, Math.floor((containerHeight + gap) / (targetHeight + gap))))
        : 4;

    const naturalCapacity = baseCols * baseRows;

    if (count <= naturalCapacity) {
      return { cols: baseCols, rows: baseRows };
    }

    if (count <= 16) return { cols: 3, rows: 6 };
    if (count <= 24) return { cols: 4, rows: 6 };
    if (count <= 30) return { cols: 5, rows: 6 };
    if (count <= 36) return { cols: 6, rows: 6 };
    if (count <= 42) return { cols: 6, rows: 7 };
    return { cols: 6, rows: 8 };
  }
}

function getWideIdeaIds(ideas: Idea[], totalSlots: number): Set<string> {
  // Regla 1: Solo ideas de longitud sustancial (mínimo 75 caracteres) son elegibles para 2 columnas
  const eligibleIdeas = ideas.filter(
    (idea) => idea.content.trim().length >= 75,
  );
  if (eligibleIdeas.length === 0) return new Set();

  // Regla 2: En fase de llenado progresivo se preserva el orden uniforme de 1 columna
  if (ideas.length < Math.floor(totalSlots * 0.75)) {
    return new Set();
  }

  const extraSlots = totalSlots - ideas.length;
  if (extraSlots <= 0) return new Set();

  // Ordenar elegibles de mayor a menor longitud
  const sorted = [...eligibleIdeas].sort(
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
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promotingOwnerGenRef = useRef<number | null>(null);
  const reconcileOwnerGenRef = useRef<number | null>(null);
  const reconcilePendingGenRef = useRef<number | null>(null);
  const verificationAttemptsRef = useRef<Map<string, number>>(new Map());
  const catchUpFailuresRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const activityGenerationRef = useRef<number>(0);
  const activityIdRef = useRef<string>(activityId);
  const publicCodeRef = useRef<string>(publicCode);
  const initialIdeasRef = useRef<Idea[]>(initialIdeas);
  const previousContextKeyRef = useRef<string | null>(null);

  const clearPresentationTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // 1. Ciclo de vida de montaje / desmontaje general del componente
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 2. Sincronización continua de referencias para callbacks estables (sin reiniciar contexto)
  useEffect(() => {
    activityIdRef.current = activityId;
    publicCodeRef.current = publicCode;
    initialIdeasRef.current = initialIdeas;
  }, [activityId, publicCode, initialIdeas]);

  // Declaración diferida de requestReconcile mediante ref para romper ciclos con promoteNext
  const requestReconcileRef = useRef<() => void>(() => {});

  const promoteNext = useCallback(async () => {
    if (!isMountedRef.current) return;
    const gen = activityGenerationRef.current;
    const currentActivityId = activityIdRef.current;
    const currentPublicCode = publicCodeRef.current;

    // Propiedad de la cerradura: si otra operación ya posee la cerradura, no intervenir
    if (promotingOwnerGenRef.current !== null) return;
    if (stateRef.current.featured !== null) return;

    if (stateRef.current.queue.length === 0) {
      // Estado IDLE: activar resync como indica la sección 13
      if (activityGenerationRef.current === gen) {
        requestReconcileRef.current();
      }
      return;
    }

    promotingOwnerGenRef.current = gen;
    try {
      // Catch-up antes de promoción: mientras watermark < head, descubrir contiguamente
      while (true) {
        if (!isMountedRef.current || activityGenerationRef.current !== gen) {
          return;
        }

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
            .select(
              "id, activity_id, content, status, created_at, published_at",
            )
            .eq("activity_id", activityIdRef.current)
            .eq("status", "published")
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(BATCH_CAP);

          if (currentWm) {
            catchUpQuery = catchUpQuery.or(
              currentWm.id
                ? `created_at.gt.${currentWm.createdAt},and(created_at.eq.${currentWm.createdAt},id.gt.${currentWm.id})`
                : `created_at.gt.${currentWm.createdAt}`,
            );
          }

          const { data: catchUpData, error: catchUpError } = await catchUpQuery;

          if (!isMountedRef.current || activityGenerationRef.current !== gen) {
            return;
          }

          if (catchUpError || !catchUpData) {
            catchUpFailed = true;
          } else {
            const catchUpIdeas = catchUpData as Idea[];
            if (catchUpIdeas.length === 0) {
              // Cero filas posteriores al watermark: la contigüidad NO queda demostrada.
              // FIFO ESTRICTO: no promover ni diferir la cabeza. Se sale del catch-up y el
              // gate de contigüidad programa un reintento con backoff acotado.
              break;
            }

            const lastCaught = catchUpIdeas[catchUpIdeas.length - 1];
            watermarkRef.current = maxCursor(watermarkRef.current, lastCaught);

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
          // El catch-up falló por error de red o consulta; salir para activar el gate de contigüidad
          break;
        }
      }

      if (!isMountedRef.current || activityGenerationRef.current !== gen) {
        return;
      }

      // 4. Gate de contigüidad del catch-up:
      // Antes de cualquier promoción, DEMOSTRAR que el watermark cubre la cabeza según compareIdeaWithCursor.
      const headAfterCatchUp = stateRef.current.queue[0];
      if (!headAfterCatchUp) {
        // La cola quedó vacía tras el catch-up
        if (activityGenerationRef.current === gen) {
          requestReconcileRef.current();
        }
        return;
      }

      const currentWm = watermarkRef.current;
      const isContiguityCovered =
        currentWm !== null &&
        compareIdeaWithCursor(headAfterCatchUp, currentWm) <= 0;

      if (!isContiguityCovered) {
        // Si el watermark no cubre la cabeza (lote incompleto, 0 filas o fallo de consulta),
        // NO promover. Programar reintento diferido con backoff progresivo sin duplicar.
        const failures = catchUpFailuresRef.current + 1;
        catchUpFailuresRef.current = failures;
        const delay = Math.min(
          1500 * 1.5 ** (failures - 1),
          RESYNC_INTERVAL_MS,
        );
        clearRetryTimer();
        const scheduledGen = gen;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (
            !isMountedRef.current ||
            activityGenerationRef.current !== scheduledGen
          ) {
            return;
          }
          void promoteNext();
        }, delay);
        return;
      }

      // Contigüidad demostrada: restablecer contador de fallos de catch-up
      catchUpFailuresRef.current = 0;

      const nextCandidate = headAfterCatchUp;
      const candidateId = nextCandidate.id;

      // Validación de featured: guardFeatured(id) (Sección 11) - Fail-Closed
      type VerificationOutcome =
        | { kind: "approved" }
        | { kind: "rejected" }
        | { kind: "unverified" }
        | { kind: "transient_error"; error: unknown };

      let outcome: VerificationOutcome;
      try {
        const supabase = createClient();
        const { data: verified, error: verifyError } = await supabase
          .from("ideas")
          .select("id, status")
          .eq("activity_id", currentActivityId)
          .eq("id", candidateId)
          .maybeSingle();

        if (verifyError) {
          outcome = { kind: "transient_error", error: verifyError };
        } else if (!verified) {
          // data: null -> ausencia de autorización en este momento
          outcome = { kind: "unverified" };
        } else if (verified.status === "published") {
          outcome = { kind: "approved" };
        } else {
          // verified.status !== "published" (status confirmado no elegible: hidden o pending)
          outcome = { kind: "rejected" };
        }
      } catch (err) {
        outcome = { kind: "transient_error", error: err };
      }

      if (!isMountedRef.current || activityGenerationRef.current !== gen) {
        return;
      }

      // Re-validación de identidad del candidato y estado de presentación tras el await
      const currentHead = stateRef.current.queue[0];
      if (!currentHead || currentHead.id !== candidateId) {
        // La cabeza cambió concurrentemente durante la verificación.
        // FIFO ESTRICTO: no promover candidateId (se saltaría la nueva cabeza).
        // Para no dejar la cola detenida, si no hay destacada y hay cola pendiente, reintentar promoción.
        if (
          stateRef.current.featured === null &&
          stateRef.current.queue.length > 0
        ) {
          const scheduledGen = gen;
          clearRetryTimer();
          // Reintento acotado (50 ms) para evitar tormenta de reintentos inmediatos
          // permitiendo que el estado se estabilice antes de evaluar la nueva cabeza
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (
              !isMountedRef.current ||
              activityGenerationRef.current !== scheduledGen
            ) {
              return;
            }
            void promoteNext();
          }, 50);
        }
        return;
      }
      if (stateRef.current.featured !== null) {
        // Ya existe una idea destacada activa en la presentación
        return;
      }

      // Manejo según el resultado de la verificación
      if (outcome.kind === "rejected") {
        // Idea moderada/eliminada confirmada: remover de cola y procesar siguiente
        verificationAttemptsRef.current.delete(candidateId);
        clearRetryTimer();
        const remaining = stateRef.current.queue.filter(
          (i) => i.id !== candidateId,
        );
        stateRef.current.queue = remaining;
        setQueue(remaining);
        const scheduledGen = gen;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (
            !isMountedRef.current ||
            activityGenerationRef.current !== scheduledGen
          ) {
            return;
          }
          void promoteNext();
        }, 50);
        return;
      }

      if (outcome.kind === "unverified") {
        // Fila ausente: fail-closed. No se interpreta como prueba definitiva de moderación.
        // FIFO ESTRICTO: la cabeza NO se retira ni se difiere. Permanece en cola y se
        // reintenta con backoff acotado hasta demostrar contigüidad/publicación.
        const attempts =
          (verificationAttemptsRef.current.get(candidateId) ?? 0) + 1;
        verificationAttemptsRef.current.set(candidateId, attempts);
        const delay = Math.min(
          2000 * 1.5 ** (attempts - 1),
          RESYNC_INTERVAL_MS,
        );
        clearRetryTimer();
        const scheduledGen = gen;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (
            !isMountedRef.current ||
            activityGenerationRef.current !== scheduledGen
          ) {
            return;
          }
          void promoteNext();
        }, delay);
        return;
      }

      if (outcome.kind === "transient_error") {
        // Error de red / consulta: fail-closed.
        // Conservar cola intacta a la cabeza para preservar FIFO y programar reintento con backoff.
        const attempts =
          (verificationAttemptsRef.current.get(candidateId) ?? 0) + 1;
        verificationAttemptsRef.current.set(candidateId, attempts);

        const delay = Math.min(
          1500 * 1.5 ** (attempts - 1),
          RESYNC_INTERVAL_MS,
        );
        clearRetryTimer();
        const scheduledGen = gen;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (
            !isMountedRef.current ||
            activityGenerationRef.current !== scheduledGen
          ) {
            return;
          }
          void promoteNext();
        }, delay);
        return;
      }

      // Promoción a featured: únicamente en outcome.kind === "approved"
      verificationAttemptsRef.current.delete(candidateId);
      clearRetryTimer();
      const remainingQueue = stateRef.current.queue.filter(
        (i) => i.id !== candidateId,
      );
      const nextFeatured: FeaturedItem = {
        idea: nextCandidate,
        phase: "holding",
      };
      stateRef.current.queue = remainingQueue;
      stateRef.current.featured = nextFeatured;
      setQueue(remainingQueue);
      setFeatured(nextFeatured);

      // Ciclo de presentación: HOLD 8s -> TRANSICIÓN 700ms -> COMPLETION
      clearPresentationTimer();
      const scheduledGen = gen;
      timerRef.current = setTimeout(() => {
        if (
          !isMountedRef.current ||
          activityGenerationRef.current !== scheduledGen
        ) {
          return;
        }

        setFeatured((prev) => {
          if (
            !isMountedRef.current ||
            activityGenerationRef.current !== scheduledGen
          ) {
            return prev;
          }
          const next = transitionFeatured(prev);
          stateRef.current.featured = next;
          return next;
        });

        timerRef.current = setTimeout(() => {
          if (
            !isMountedRef.current ||
            activityGenerationRef.current !== scheduledGen
          ) {
            return;
          }

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
            persistCursor(sessionStorage, currentPublicCode, newCursor);
          }

          // 3. Siguiente idea o idle
          void promoteNext();
        }, TRANSITION_DURATION_MS);
      }, HOLD_DURATION_MS);
    } finally {
      // Propiedad estricta: solo liberar si esta invocación sigue siendo la propietaria
      if (promotingOwnerGenRef.current === gen) {
        promotingOwnerGenRef.current = null;
      }
    }
  }, [clearPresentationTimer, clearRetryTimer]);

  const executeReconcile = useCallback(async () => {
    try {
      const gen = activityGenerationRef.current;
      const currentActivityId = activityIdRef.current;
      const supabase = createClient();
      const currentWm = watermarkRef.current ?? cursorRef.current;

      // 1. Discovery lexicográfico con limit(100) (Sección 8.2)
      let discoverQuery = supabase
        .from("ideas")
        .select("id, activity_id, content, status, created_at, published_at")
        .eq("activity_id", currentActivityId)
        .eq("status", "published")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(BATCH_CAP);

      if (currentWm) {
        discoverQuery = discoverQuery.or(
          currentWm.id
            ? `created_at.gt.${currentWm.createdAt},and(created_at.eq.${currentWm.createdAt},id.gt.${currentWm.id})`
            : `created_at.gt.${currentWm.createdAt}`,
        );
      }

      // 2. Moderación acotada a máximo 49 IDs (Sección 11)
      // Priorizar: cabeza de cola activa, idea destacada y muro.
      const snapshot = stateRef.current;
      const activeIdsToCheck: string[] = [];
      const added = new Set<string>();

      const addId = (id: string | undefined) => {
        if (id && !added.has(id) && activeIdsToCheck.length < 49) {
          added.add(id);
          activeIdsToCheck.push(id);
        }
      };

      // Prioridad 1: Cabeza de la cola activa (cupo reservado prioritario)
      if (snapshot.queue.length > 0) {
        addId(snapshot.queue[0].id);
      }
      // Prioridad 2: Tarjeta destacada
      if (snapshot.featured) {
        addId(snapshot.featured.idea.id);
      }
      // Prioridad 3: Ideas del muro
      for (const w of snapshot.wall) {
        addId(w.id);
      }
      // Prioridad 4: Resto de la cola activa hasta agotar el presupuesto de 49 IDs
      for (let i = 1; i < snapshot.queue.length; i++) {
        addId(snapshot.queue[i].id);
      }

      let moderationQuery = null;
      if (activeIdsToCheck.length > 0) {
        // Consultar sin filtrar por status="published" para diferenciar:
        // - status === "published": confirmado publicado
        // - status !== "published": confirmado moderado/no publicado
        // - ausencia de fila: fila ausente
        moderationQuery = supabase
          .from("ideas")
          .select("id, status")
          .eq("activity_id", currentActivityId)
          .in("id", activeIdsToCheck);
      }

      const [discoverResult, moderationResult] = await Promise.all([
        discoverQuery,
        moderationQuery
          ? moderationQuery
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!isMountedRef.current || activityGenerationRef.current !== gen) {
        return;
      }

      // FRESH SNAPSHOT (I8, CA-1)
      const fresh = stateRef.current;

      // Procesar Discovery solo si no hubo error
      let discoveredIdeas: Idea[] = [];
      if (!discoverResult.error && discoverResult.data) {
        discoveredIdeas = discoverResult.data as Idea[];
        if (discoveredIdeas.length > 0) {
          const lastDiscovered = discoveredIdeas[discoveredIdeas.length - 1];
          watermarkRef.current = maxCursor(
            watermarkRef.current,
            lastDiscovered,
          );
        }
      }

      // Procesar Moderación solo si la consulta tuvo éxito (I7: Error ≠ Vacío)
      let purgedState = fresh;
      let featuredInterrupted = false;

      if (moderationQuery && !moderationResult.error && moderationResult.data) {
        const rows = moderationResult.data as { id: string; status: string }[];
        const confirmedPublishedIds = new Set<string>();
        const confirmedModeratedIds = new Set<string>();

        for (const row of rows) {
          if (row.status === "published") {
            confirmedPublishedIds.add(row.id);
          } else {
            // Estado no publicado confirmado (hidden, pending, rejected)
            confirmedModeratedIds.add(row.id);
          }
        }

        // CONTRATO REAL DE purgeModeratedIdeas (src/lib/presentation.ts):
        // purgeModeratedIdeas(state, activeIdsQueried, confirmedPublishedIds)
        // Regla: isModerated(id) = queriedSet.has(id) && !confirmedPublishedIds.has(id).
        // Todo ID en activeIdsQueried que NO esté en confirmedPublishedIds es purgado de wall y queue.
        //
        // 1. Para 'wall' y 'featured': requerimos fail-closed en pantalla. Se incluyen en
        //    activeIdsQueried para que si ya no están publicadas (o están ausentes), salgan de pantalla.
        // 2. Para 'queue': la política FIFO estricta PROHÍBE considerar filas ausentes o restricciones
        //    de RLS como prueba definitiva de moderación. Por ello, las ideas de 'queue' SOLO se
        //    agregan a activeIdsQueried cuando la consulta devolvió explícitamente un estado no publicado
        //    confirmado ('confirmedModeratedIds'). Las filas ausentes en cola NO se incluyen en
        //    activeIdsQueried, preservándolas en cola para reintentos con backoff acotado en guardFeatured.
        // 3. IDs fuera de cupo (presupuesto <= 49): no se consultaron, por lo que NO se incluyen en
        //    activeIdsQueried y no se purgan erróneamente por falta de consulta.
        const queriedIds = new Set(activeIdsToCheck);
        const idsToPurgeFromPresentation: string[] = [];
        if (fresh.featured && queriedIds.has(fresh.featured.idea.id)) {
          idsToPurgeFromPresentation.push(fresh.featured.idea.id);
        }
        for (const w of fresh.wall) {
          if (queriedIds.has(w.id)) idsToPurgeFromPresentation.push(w.id);
        }
        for (const modId of confirmedModeratedIds) {
          idsToPurgeFromPresentation.push(modId);
        }

        const res = purgeModeratedIdeas(
          fresh,
          idsToPurgeFromPresentation,
          confirmedPublishedIds,
        );
        purgedState = res.nextState;
        featuredInterrupted = res.interrupted;
      }

      // Incorporar ideas descubiertas y recuperadas en la cola fresca sin duplicados
      const activeIds = new Set<string>();
      for (const item of purgedState.wall) activeIds.add(item.id);
      for (const item of purgedState.queue) activeIds.add(item.id);
      if (purgedState.featured) activeIds.add(purgedState.featured.idea.id);

      const ideasToEnqueue = discoveredIdeas;
      const updatedQueue = enqueueIdeas(
        purgedState.queue,
        ideasToEnqueue,
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
          reconcilePendingGenRef.current = gen;
        }
      }
    } catch {
      // Error silencioso: no purga ni altera estado (I7)
    }
  }, [clearPresentationTimer, promoteNext]);

  // Single-flight + pending rerun con propiedad estricta por generación (Sección 10.1, I9)
  const requestReconcile = useCallback(() => {
    if (!isMountedRef.current) return;
    const gen = activityGenerationRef.current;

    if (reconcileOwnerGenRef.current !== null) {
      reconcilePendingGenRef.current = gen;
      return;
    }
    reconcileOwnerGenRef.current = gen;

    const run = async () => {
      try {
        await executeReconcile();
      } finally {
        if (reconcileOwnerGenRef.current === gen) {
          reconcileOwnerGenRef.current = null;
        }
        // Solo consumir pending rerun si corresponde estrictamente a la generación actual activa
        if (
          isMountedRef.current &&
          reconcilePendingGenRef.current === activityGenerationRef.current &&
          activityGenerationRef.current === gen
        ) {
          reconcilePendingGenRef.current = null;
          requestReconcileRef.current();
        }
      }
    };

    void run();
  }, [executeReconcile]);

  // Sincronizar la ref de requestReconcile tras cada render (sin mutaciones síncronas en render)
  useEffect(() => {
    requestReconcileRef.current = requestReconcile;
  }, [requestReconcile]);

  const handleNewIdea = useCallback(
    (idea: Idea) => {
      if (!isMountedRef.current) return;
      // Filtrar ideas pertenecientes a otra actividad
      if (idea.activity_id && idea.activity_id !== activityIdRef.current) {
        return;
      }
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
      if (!isMountedRef.current) return;
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

  // Gestión del contexto (A -> B, B -> A, recarga y cambio de publicCode)
  // Depende EXCLUSIVAMENTE de activityId y publicCode (independiente de referencias de initialIdeas).
  useEffect(() => {
    const currentContextKey = `${activityId}:${publicCode}`;
    setJoinUrl(`${window.location.origin}/a/${publicCode}`);

    if (previousContextKeyRef.current === null) {
      // 1. Primera apertura del componente (SSR inicial)
      previousContextKeyRef.current = currentContextKey;
      activityGenerationRef.current += 1;

      const initial = initialIdeasRef.current;
      const stored = readStoredCursor(sessionStorage, publicCode);
      if (!stored.exists) {
        // Primera apertura: Punto cero (sin catch-up histórico)
        if (initial.length > 0) {
          const maxInit = findMaxIdea(initial);
          cursorRef.current = maxInit;
          watermarkRef.current = maxInit;
          persistCursor(sessionStorage, publicCode, maxInit);
          const baseline = initial.slice(0, MAX_WALL_CARDS);
          stateRef.current.wall = baseline;
          setWall(baseline);
        } else {
          // Objetivo 6: Primera apertura sin initialIdeas -> punto cero temporal
          // para no descubrir accidentalmente todo el histórico de la base de datos.
          const zeroCursor: Cursor = {
            createdAt: new Date().toISOString(),
            id: "",
          };
          cursorRef.current = zeroCursor;
          watermarkRef.current = zeroCursor;
          persistCursor(sessionStorage, publicCode, zeroCursor);
          stateRef.current.wall = [];
          setWall([]);
        }
      } else {
        // Recarga de pestaña (H-03): ideas posteriores al cursor son elegibles para presentación
        cursorRef.current = stored.cursor;
        watermarkRef.current = stored.cursor;

        if (stored.cursor) {
          const baseline = initial.filter(
            (i) => !isAfterCursor(i, stored.cursor),
          );
          const pendingFromInitial = initial.filter((i) =>
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
          const sortedInitial = initial.slice().sort(compareIdeasFIFO);
          stateRef.current.queue = sortedInitial;
          setWall([]);
          setQueue(sortedInitial);
        }

        // Reconcile inmediato tras recarga
        requestReconcileRef.current();
        if (stateRef.current.queue.length > 0) {
          void promoteNext();
        }
      }
    } else if (previousContextKeyRef.current !== currentContextKey) {
      // 2. Transición real de contexto (A -> B, B -> A, o cambio de publicCode)
      previousContextKeyRef.current = currentContextKey;
      activityGenerationRef.current += 1;

      // Invalida cerraduras y cancela temporizadores del contexto anterior
      promotingOwnerGenRef.current = null;
      reconcileOwnerGenRef.current = null;
      reconcilePendingGenRef.current = null;
      clearPresentationTimer();
      clearRetryTimer();
      verificationAttemptsRef.current.clear();
      catchUpFailuresRef.current = 0;

      // Limpia completamente el estado visual y la cola para no mezclar contextos
      stateRef.current = {
        wall: [],
        queue: [],
        featured: null,
      };
      setWall([]);
      setQueue([]);
      setFeatured(null);

      // Inicializa cursor para el nuevo publicCode
      const stored = readStoredCursor(sessionStorage, publicCode);
      if (stored.exists) {
        cursorRef.current = stored.cursor;
        watermarkRef.current = stored.cursor;
      } else {
        const zeroCursor: Cursor = {
          createdAt: new Date().toISOString(),
          id: "",
        };
        cursorRef.current = zeroCursor;
        watermarkRef.current = zeroCursor;
        persistCursor(sessionStorage, publicCode, zeroCursor);
      }

      // Reconciliación inmediata de la nueva actividad
      requestReconcileRef.current();
    } else {
      // Re-ejecución con la misma clave: recuperar reconciliación o promoción.
      if (
        stateRef.current.queue.length > 0 &&
        stateRef.current.featured === null
      ) {
        void promoteNext();
      } else if (stateRef.current.queue.length === 0) {
        requestReconcileRef.current();
      }
    }

    return () => {
      // Cleanup al desmontar o antes de cambiar al siguiente contexto
      activityGenerationRef.current += 1;
      promotingOwnerGenRef.current = null;
      reconcileOwnerGenRef.current = null;
      reconcilePendingGenRef.current = null;
      clearPresentationTimer();
      clearRetryTimer();
      verificationAttemptsRef.current.clear();
      catchUpFailuresRef.current = 0;
    };
  }, [
    activityId,
    publicCode,
    clearPresentationTimer,
    clearRetryTimer,
    promoteNext,
  ]);

  // Suscripción Realtime, resync al SUBSCRIBED y resync periódico (10s)
  useEffect(() => {
    const supabase = createClient();
    const currentActivityId = activityId;
    const channel = supabase
      .channel(`ideas:${activityId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ideas",
        },
        (payload) => {
          // Filtrar eventos si la actividad activa ya no coincide con el canal
          if (activityIdRef.current !== currentActivityId) {
            return;
          }

          if (payload.eventType === "DELETE") {
            if (payload.old.activity_id !== currentActivityId) {
              return;
            }
            handleRemoveIdea(payload.old.id);
            return;
          }
          const idea = payload.new as Idea;
          // Validar que la idea pertenezca a la actividad activa
          if (idea.activity_id !== currentActivityId) {
            return;
          }

          if (idea.status === "published") {
            handleNewIdea(idea);
          } else {
            handleRemoveIdea(idea.id);
          }
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (activityIdRef.current === currentActivityId) {
            requestReconcile();
          }
        }
      });

    const resyncInterval = setInterval(() => {
      if (activityIdRef.current === currentActivityId) {
        requestReconcile();
      }
    }, RESYNC_INTERVAL_MS);

    return () => {
      clearInterval(resyncInterval);
      void supabase.removeChannel(channel);
    };
  }, [activityId, handleNewIdea, handleRemoveIdea, requestReconcile]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestReconcileRef.current();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

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
  const visibleRows = Math.min(rows, 5);
  const cellHeight =
    containerSize.height > 0
      ? (containerSize.height - gap * (visibleRows - 1)) / visibleRows
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
                const actualCardWidth = isWide
                  ? cellWidth * 2 + gap
                  : cellWidth;
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
                size={208}
                level="H"
                marginSize={4}
                title="Código QR para participar"
                imageSettings={{
                  src: "/muro-mark.svg",
                  width: 40,
                  height: 40,
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
        <span className="wall-footer-author">
          Desarrollado por Lucas Damián Montero ·{" "}
          <AboutModal
            triggerText="Acerca de"
            triggerStyle={{
              color: "inherit",
              textDecoration: "underline",
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
              cursor: "pointer",
            }}
          />
        </span>
        <span>Una conversación abierta.</span>
      </footer>
    </main>
  );
}
