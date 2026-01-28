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
): Promise<{ ok: boolean; status: number; data: T | null; text: string | null; duration_ms: number }> {
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? 10_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const status = res.status;
    const contentType = res.headers.get("content-type") ?? "";
    const duration_ms = Date.now() - startedAt;
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as T;
      return { ok: res.ok, status, data, text: null, duration_ms };
    }
    const text = await res.text();
    return { ok: res.ok, status, data: null, text, duration_ms };
  } catch (error) {
    // Node/undici throws AbortError on timeout. Return a stable shape so callers can surface
    // a useful error message instead of crashing the cycle.
    const name = error instanceof Error ? error.name : null;
    const message = error instanceof Error ? error.message : String(error);
    if (name === "AbortError" || message.toLowerCase().includes("aborted")) {
      return {
        ok: false,
        status: 0,
        data: null,
        text: `timeout after ${timeoutMs}ms`,
        duration_ms: Date.now() - startedAt,
      };
    }

    if (error instanceof Error) {
      const parts: string[] = [];
      parts.push(`${error.name}: ${error.message}`);

      const anyErr = error as unknown as {
        code?: unknown;
        cause?: unknown;
      };

      if (anyErr.code) {
        parts.push(`code=${String(anyErr.code)}`);
      }

      if (anyErr.cause) {
        if (anyErr.cause instanceof Error) {
          parts.push(`cause=${anyErr.cause.name}: ${anyErr.cause.message}`);
          const causeAny = anyErr.cause as unknown as { code?: unknown };
          if (causeAny.code) {
            parts.push(`cause_code=${String(causeAny.code)}`);
          }
        } else {
          parts.push(`cause=${String(anyErr.cause)}`);
        }
      }

      return { ok: false, status: 0, data: null, text: parts.join(" | "), duration_ms: Date.now() - startedAt };
    }

    return { ok: false, status: 0, data: null, text: message, duration_ms: Date.now() - startedAt };
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
