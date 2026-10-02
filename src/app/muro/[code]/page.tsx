import { notFound } from "next/navigation";
import { LiveWall } from "@/components/live-wall";
import { createClient } from "@/lib/supabase/server";
import type { Idea } from "@/lib/types";

export default async function PublicWallPage({
  params,
}: PageProps<"/muro/[code]">) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: activity } = await supabase
    .from("activities")
    .select("id, public_code, title, question, status")
    .eq("public_code", code.toUpperCase())
    .maybeSingle();
  if (!activity) notFound();

  const { data } = await supabase
    .from("ideas")
    .select("id, activity_id, content, status, created_at, published_at")
    .eq("activity_id", activity.id)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  return (
    <LiveWall
      activityId={activity.id}
      publicCode={activity.public_code}
      title={activity.title}
      question={activity.question}
      initialIdeas={(data ?? []) as Idea[]}
    />
  );
}
