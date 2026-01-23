"use server";

import { getAppUrl, getRequiredEnv } from "@/lib/env";

export type RunChecksResult = {
  checked: number;
  notificationsSent: number;
  incidentsCreated: number;
  incidentsResolved: number;
  errors: string[];
};

export async function runChecksAction(): Promise<RunChecksResult> {
  const cronSecret = getRequiredEnv("CRON_SECRET");
  const appUrl = getAppUrl();

  const response = await fetch(`${appUrl}/api/cron/check-monitors`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "cron-secret": cronSecret,
    },
  });

  if (!response.ok) {
    const payloadText = await response.text();
    let message: string | null = null;
    try {
      const parsed = JSON.parse(payloadText);
      message = parsed?.error ?? parsed?.message ?? null;
    } catch {
      message = payloadText;
    }
    throw new Error(message ?? "Erro ao executar verificações");
  }

  return (await response.json()) as RunChecksResult;
}
