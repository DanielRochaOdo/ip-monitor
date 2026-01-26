import { z } from "zod";

const emailSchema = z.string().email();

export function parseRecipientEmails(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];

  // Support "a@b.com, c@d.com" and "a@b.com; c@d.com" (and mixed).
  const parts = value
    .split(/[;,]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts;
}

export function validateRecipientEmails(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const parts = parseRecipientEmails(raw);
  if (!parts.length) {
    return { ok: false, error: "Informe pelo menos um email de alerta." };
  }

  const invalid = parts.filter((email) => !emailSchema.safeParse(email).success);
  if (invalid.length) {
    return { ok: false, error: `Email(s) invalido(s): ${invalid.join(", ")}` };
  }

  // Normalize to a consistent format in the DB.
  return { ok: true, value: parts.join(", ") };
}

