import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const MAX_EXPORT_LIMIT = 5000;
export const BATCH_SIZE = 1000;

export const exportQuerySchema = z.object({
  format: z.enum(["csv", "html"], {
    message: "El formato debe ser 'csv' o 'html'",
  }),
  scope: z.enum(["published", "all"]).default("published"),
});

export type ExportQueryParams = z.infer<typeof exportQuerySchema>;

export type ExportSupabaseClient =
  | SupabaseClient
  | {
      auth: {
        getUser: () => Promise<{
          data: { user: { id: string; email?: string } | null };
          error?: unknown;
        }>;
      };
      // biome-ignore lint/suspicious/noExplicitAny: Permite clientes mock en tests unitarios e integración
      from: (table: string) => any;
    };
