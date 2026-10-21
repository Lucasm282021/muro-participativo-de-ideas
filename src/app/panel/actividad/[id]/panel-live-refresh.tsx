"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface PanelLiveRefreshProps {
  activityId: string;
}

export function PanelLiveRefresh({ activityId }: PanelLiveRefreshProps) {
  const router = useRouter();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`panel:ideas:${activityId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ideas",
        },
        (payload) => {
          const newRecord = payload.new as { activity_id?: string } | undefined;
          const oldRecord = payload.old as { activity_id?: string } | undefined;
          const targetActivityId =
            newRecord?.activity_id ?? oldRecord?.activity_id;

          if (targetActivityId !== activityId) {
            return;
          }

          if (timerRef.current) {
            clearTimeout(timerRef.current);
          }

          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            router.refresh();
          }, 400);
        },
      )
      .subscribe();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [activityId, router]);

  return null;
}
