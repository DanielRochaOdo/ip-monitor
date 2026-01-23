export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
}

export function getOptionalEnv(key: string): string | null {
  const value = process.env[key];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// APP_URL is convenient locally, but in Vercel you often don't know the final URL
// until after the first deploy. Fall back to VERCEL_URL automatically.
export function getAppUrl(): string {
  const explicit = getOptionalEnv("APP_URL");
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelUrl = getOptionalEnv("VERCEL_URL");
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}
