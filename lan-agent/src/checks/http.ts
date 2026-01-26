export type HttpStatus = "UP" | "DOWN" | "DEGRADED";

export type HttpResult = {
  status: HttpStatus;
  latencyMs: number | null;
  error: string | null;
  statusCode: number | null;
};

export async function httpCheck(opts: {
  url: string;
  method?: "GET" | "HEAD";
  expectedStatus?: number;
  timeoutMs?: number;
}): Promise<HttpResult> {
  const started = Date.now();
  const method = opts.method ?? "GET";
  const expected = opts.expectedStatus ?? 200;

  try {
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 3000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(opts.url, { method, signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - started;
    if (res.status === expected) {
      return { status: "UP", latencyMs, error: null, statusCode: res.status };
    }
    // Reachable but not what we expected (auth redirect, 403, etc).
    return {
      status: "DEGRADED",
      latencyMs,
      error: `http unexpected status ${res.status} (expected ${expected})`,
      statusCode: res.status,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    return { status: "DOWN", latencyMs: null, error: message, statusCode: null };
  }
}
