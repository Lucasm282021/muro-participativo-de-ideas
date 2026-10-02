"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Idea } from "@/lib/types";

export function LiveWall({
  activityId,
  publicCode,
  title,
  question,
  initialIdeas,
}: {
  activityId: string;
  publicCode: string;
  title: string;
  question: string;
  initialIdeas: Idea[];
}) {
  const [ideas, setIdeas] = useState(initialIdeas);
  const [joinUrl, setJoinUrl] = useState("");

  useEffect(() => {
    setJoinUrl(`${window.location.origin}/a/${publicCode}`);
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
            setIdeas((current) =>
              current.filter((idea) => idea.id !== payload.old.id),
            );
            return;
          }
          const idea = payload.new as Idea;
          setIdeas((current) => {
            const withoutOld = current.filter((item) => item.id !== idea.id);
            return idea.status === "published"
              ? [idea, ...withoutOld]
              : withoutOld;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activityId, publicCode]);

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
          className="idea-grid"
          aria-live="polite"
          aria-label="Ideas publicadas"
        >
          {ideas.length ? (
            ideas.map((idea, index) => (
              <article
                className={`idea-card idea-card-${index % 5}`}
                key={idea.id}
              >
                <span className="idea-number">
                  {String(ideas.length - index).padStart(2, "0")}
                </span>
                <p>{idea.content}</p>
              </article>
            ))
          ) : (
            <div className="empty-wall">
              <span className="empty-spark">✳</span>
              <h2>Este muro empieza con vos.</h2>
              <p>Escaneá el código y compartí la primera idea.</p>
            </div>
          )}
        </section>
        <aside className="wall-join-card">
          <div className="eyebrow">PARTICIPÁ</div>
          <h2>Tu voz también suma.</h2>
          <p>Escaneá el código con tu celular para dejar una idea.</p>
          {joinUrl && (
            <div className="qr-frame">
              <QRCodeSVG value={joinUrl} size={144} level="M" includeMargin />
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
