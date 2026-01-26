import { spawn } from "node:child_process";

export type IcmpResult = {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
};

function parseLatencyMs(output: string) {
  // Linux/macOS: time=12.3 ms
  const match = output.match(/time[=<]([\d.]+)\s*ms/i);
  if (match?.[1]) {
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  // Windows sometimes reports "time<1ms"
  if (/time<\s*1ms/i.test(output)) {
    return 1;
  }
  return null;
}

export async function icmpPing(ip: string, timeoutMs = 2500): Promise<IcmpResult> {
  return new Promise<IcmpResult>((resolve) => {
    const args =
      process.platform === "win32"
        ? ["-n", "1", "-w", String(timeoutMs), ip]
        : ["-c", "1", "-W", String(Math.max(1, Math.floor(timeoutMs / 1000))), ip];

    const proc = spawn("ping", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill();
      resolve({ ok: false, latencyMs: null, error: "icmp timeout" });
    }, timeoutMs + 250);

    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    proc.once("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, latencyMs: null, error: err.message });
    });

    proc.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, latencyMs: parseLatencyMs(stdout) ?? null, error: null });
      } else {
        resolve({ ok: false, latencyMs: null, error: (stderr || stdout || `icmp exit ${code}`).trim() });
      }
    });
  });
}

