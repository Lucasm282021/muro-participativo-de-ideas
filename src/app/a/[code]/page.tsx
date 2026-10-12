import Link from "next/link";
import { notFound } from "next/navigation";
import { IdeaForm } from "@/components/idea-form";
import { createPublicClient } from "@/lib/supabase/public";

export default async function JoinActivityPage({
  params,
}: PageProps<"/a/[code]">) {
  const { code } = await params;
  const supabase = createPublicClient();
  const { data: activity } = await supabase
    .from("activities")
    .select("id, public_code, title, question, status")
    .eq("public_code", code.toUpperCase())
    .maybeSingle();
  if (!activity) notFound();
  const isOpen = activity.status === "open";

  return (
    <main className="join-page">
      <header className="join-header">
        <Link className="brand brand-dark" href="/">
          <span className="brand-mark">
            m<span>.</span>
          </span>
          <span>
            muro<span className="brand-light">común</span>
          </span>
        </Link>
        <span className={`status-pill status-${activity.status}`}>
          {isOpen ? "Actividad abierta" : "Actividad cerrada"}
        </span>
      </header>
      <div className="join-layout">
        <section className="join-copy">
          <div className="eyebrow">UN ESPACIO PARA ESCUCHAR</div>
          <h1>{activity.title}</h1>
          <div className="join-question">
            <span>LA PREGUNTA</span>
            <p>{activity.question}</p>
          </div>
          <div className="privacy-note">
            <span className="privacy-icon">◌</span>
            <p>
              Tu idea aparece sin tu nombre. Quien organiza puede ver los datos
              que usás para participar.
            </p>
          </div>
        </section>
        <section className="join-form-card">
          {isOpen ? (
            <>
              <div className="eyebrow">TU IDEA TIENE LUGAR</div>
              <h2>Sumate a la conversación.</h2>
              <p className="card-description">
                No hay respuestas correctas. Compartí algo que te gustaría ver
                pasar.
              </p>
              <IdeaForm code={activity.public_code} />
            </>
          ) : (
            <div className="closed-notice">
              <span className="closed-icon">◷</span>
              <h2>La conversación está cerrada.</h2>
              <p>
                Ya no se reciben ideas nuevas, pero podés recorrer las que
                quedaron en el muro.
              </p>
              <Link
                className="button button-primary button-wide"
                href={`/muro/${activity.public_code}`}
              >
                Ver el muro <span>↗</span>
              </Link>
            </div>
          )}
        </section>
      </div>
      <footer className="join-footer">
        <span>Una conversación abierta.</span>
        <span>CÓDIGO {activity.public_code}</span>
      </footer>
    </main>
  );
}
