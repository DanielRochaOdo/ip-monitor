import { z } from "zod";
import { validateRecipientEmails } from "@/lib/email/recipients";

export const notificationSettingsSchema = z.object({
  alert_email: z
    .string()
    .transform((value, ctx) => {
      const validated = validateRecipientEmails(value);
      if (!validated.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: validated.error });
        return z.NEVER;
      }
      return validated.value;
    }),
  notify_on_down: z.boolean(),
  notify_on_up: z.boolean(),
});

export const notificationSettingsPatchSchema = notificationSettingsSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be updated",
  });
