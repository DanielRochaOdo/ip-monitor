import { setTimeout as sleepTimeout } from "node:timers/promises";

export async function sleep(ms: number) {
  await sleepTimeout(ms);
}

export function jitterMs(maxMs: number) {
  return Math.floor(Math.random() * Math.max(0, maxMs));
}

export function getEnv(key: string, fallback?: string) {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing env var ${key}`);
  }
  return value;
}

export function getEnvInt(key: string, fallback: number) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; data: T | null; text: string | null }> {
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? 10_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const status = res.status;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as T;
      return { ok: res.ok, status, data, text: null };
    }
    const text = await res.text();
    return { ok: res.ok, status, data: null, text };
  } finally {
    clearTimeout(timeout);
  }
}

export function log(event: string, payload: Record<string, unknown> = {}) {
  // Structured logs play nicely with Docker / systemd / journald.
  // Avoid non-ASCII keys/values to keep parsing simple in various environments.
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...payload });
  // eslint-disable-next-line no-console
  console.log(line);
}

