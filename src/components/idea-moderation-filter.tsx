"use client";

import { useMemo, useRef, useState } from "react";
import { IdeaModerationActions } from "@/components/idea-moderation-actions";
import type { Idea } from "@/lib/types";

export type FilterStatus = "pending" | "published" | "hidden" | "all";

interface IdeaModerationFilterProps {
  ideas: Idea[];
  activityId: string;
  moderationMode: "automatic" | "approval";
}

export function IdeaModerationFilter({
  ideas,
  activityId,
  moderationMode,
}: IdeaModerationFilterProps) {
  // Contadores reactivos a las ideas recibidas
  const counts = useMemo(() => {
    let pending = 0;
    let published = 0;
    let hidden = 0;
    for (const idea of ideas) {
      if (idea.status === "pending") pending++;
      else if (idea.status === "published") published++;
      else if (idea.status === "hidden") hidden++;
    }
    return {
      pending,
      published,
      hidden,
      all: ideas.length,
    };
  }, [ideas]);

  // Selección inicial: "pending" si existen ideas pendientes; sino "all".
  const [selectedFilter, setSelectedFilter] = useState<FilterStatus>(() => {
    const hasPending = ideas.some((idea) => idea.status === "pending");
    return hasPending ? "pending" : "all";
  });

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Ideas filtradas según la pestaña seleccionada
  const filteredIdeas = useMemo(() => {
    if (selectedFilter === "all") return ideas;
    return ideas.filter((idea) => idea.status === selectedFilter);
  }, [ideas, selectedFilter]);

  const tabs: Array<{ id: FilterStatus; label: string; count: number }> =
    useMemo(
      () => [
        { id: "pending", label: "Por revisar", count: counts.pending },
        { id: "published", label: "En el muro", count: counts.published },
        { id: "hidden", label: "Ocultas", count: counts.hidden },
        { id: "all", label: "Todas", count: counts.all },
      ],
      [counts],
    );

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex = currentIndex;
    const total = tabs.length;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        nextIndex = (currentIndex + 1) % total;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        nextIndex = (currentIndex - 1 + total) % total;
        break;
      case "Home":
        event.preventDefault();
        nextIndex = 0;
        break;
      case "End":
        event.preventDefault();
        nextIndex = total - 1;
        break;
      default:
        return;
    }

    const nextTab = tabs[nextIndex];
    if (nextTab) {
      setSelectedFilter(nextTab.id);
      tabRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <div className="moderation-filter-container">
      <div
        className="moderation-filter-tabs"
        role="tablist"
        aria-label="Filtrar ideas por estado"
      >
        {tabs.map((tab, index) => {
          const isSelected = selectedFilter === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              className={`moderation-tab-button ${isSelected ? "active" : ""}`}
              onClick={() => setSelectedFilter(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
            >
              <span className="moderation-tab-label">{tab.label}</span>
              <span className="moderation-tab-badge">{tab.count}</span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`tabpanel-${selectedFilter}`}
        aria-labelledby={`tab-${selectedFilter}`}
        className="moderation-tab-panel"
      >
        {filteredIdeas.length > 0 ? (
          <div className="moderation-list">
            {filteredIdeas.map((idea) => (
              <article className="moderation-card" key={idea.id}>
                <div className="moderation-card-content">
                  <span className={`idea-status status-${idea.status}`}>
                    {idea.status === "pending"
                      ? "Por revisar"
                      : idea.status === "published"
                        ? "En el muro"
                        : "Oculta del muro"}
                  </span>
                  <p>{idea.content}</p>
                  <time>
                    {new Intl.DateTimeFormat("es-AR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(idea.created_at))}
                  </time>
                </div>
                <IdeaModerationActions
                  activityId={activityId}
                  ideaId={idea.id}
                  ideaStatus={idea.status as "pending" | "published" | "hidden"}
                  moderationMode={moderationMode}
                />
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-activities moderation-empty-tab">
            <span>✳</span>
            <p>
              {ideas.length === 0
                ? "Todavía no hay ideas. Cuando alguien envíe una, vas a verla acá junto con su estado."
                : selectedFilter === "pending"
                  ? "No hay ideas pendientes por revisar. Todas las ideas recibidas fueron moderadas."
                  : selectedFilter === "published"
                    ? "No hay ideas visibles en el muro en este momento."
                    : selectedFilter === "hidden"
                      ? "No hay ideas ocultas en esta actividad."
                      : "No hay ideas para mostrar en esta sección."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
