import { z } from "zod";

export const notificationSettingsSchema = z.object({
  alert_email: z.string().email(),
  notify_on_down: z.boolean(),
  notify_on_up: z.boolean(),
});

export const notificationSettingsPatchSchema = notificationSettingsSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be updated",
  });
