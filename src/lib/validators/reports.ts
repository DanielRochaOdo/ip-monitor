import { z } from "zod";

const dateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Date must be a valid ISO string",
  });

export const checksQuerySchema = z.object({
  monitorId: z.string().uuid().optional(),
  status: z.enum(["UP", "DOWN"]).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  format: z.enum(["csv", "json"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  page: z.coerce.number().int().min(1).default(1),
});
