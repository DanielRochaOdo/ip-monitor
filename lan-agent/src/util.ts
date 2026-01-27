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
  } catch (error) {
    // Node/undici throws AbortError on timeout. Return a stable shape so callers can surface
    // a useful error message instead of crashing the cycle.
    const name = error instanceof Error ? error.name : null;
    const message = error instanceof Error ? error.message : String(error);
    if (name === "AbortError" || message.toLowerCase().includes("aborted")) {
      return { ok: false, status: 0, data: null, text: `timeout after ${timeoutMs}ms` };
    }
    return { ok: false, status: 0, data: null, text: message };
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
