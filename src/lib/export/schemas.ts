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
      // biome-ignore lint/suspicious/noExplicitAny: Permite invocar RPC atómico en tests e integración
      rpc?: (fn: string, params?: Record<string, unknown>) => any;
    };

export const exportRpcResponseSchema = z.union([
  z.object({
    error: z.literal("payload_too_large"),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive().optional(),
  }),
  z.object({
    error: z.undefined().optional(),
    activity: z.object({
      id: z.string(),
      public_code: z.string(),
      title: z.string(),
      question: z.string(),
      status: z.enum(["draft", "open", "closed"]),
      created_at: z.string(),
    }),
    ideas: z.array(
      z.object({
        id: z.string(),
        content: z.string(),
        status: z.enum(["pending", "published", "hidden"]),
        created_at: z.string(),
        published_at: z.string().nullable(),
      }),
    ),
    total: z.number().int().nonnegative(),
  }),
]);

export type ExportRpcResponse = z.infer<typeof exportRpcResponseSchema>;
