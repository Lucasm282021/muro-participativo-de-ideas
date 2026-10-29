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
