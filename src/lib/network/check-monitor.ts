import net from "net";
import { spawn } from "child_process";

export type NetworkCheckResult = {
  status: "UP" | "DOWN";
  latencyMs: number | null;
  errorMessage: string | null;
  method: "TCP" | "ICMP";
};

const defaultTimeoutMs = 5000;

async function attemptPort(ipAddress: string, port: number, timeoutMs = defaultTimeoutMs): Promise<number> {
  const start = Date.now();

  return new Promise<number>((resolve, reject) => {
    const socket = new net.Socket();

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      const latency = Date.now() - start;
      cleanup();
      resolve(latency);
    });

    socket.once("error", (err) => {
      cleanup();
      reject(err);
    });

    socket.once("timeout", () => {
      cleanup();
      reject(new Error("connection timed out"));
    });

    socket.connect(port, ipAddress);
  });
}

function runIcmpPing(ipAddress: string, count = 2, timeoutMs = 3000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const args = process.platform === "win32" ? ["-n", String(count), "-w", String(timeoutMs), ipAddress] : ["-c", String(count), "-W", String(Math.floor(timeoutMs / 1000)), ipAddress];
    const proc = spawn("ping", args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      proc.kill();
      resolve(false);
    }, timeoutMs);

    proc.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });

    proc.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function runTcpHealthCheck(
  ipAddress: string,
  ports: number[] = [80, 443],
  timeoutMs = defaultTimeoutMs,
): Promise<NetworkCheckResult> {
  let lastError: string | null = null;

  const tryPingFallback = async () => {
    const success = await runIcmpPing(ipAddress);
    if (success) {
      return {
        status: "UP" as const,
        latencyMs: null,
        errorMessage: "TCP ports closed but ICMP ping succeeded",
        method: "ICMP" as const,
      };
    }
    return null;
  };

  for (const port of ports) {
    try {
      const latency = await attemptPort(ipAddress, port, timeoutMs);
      return {
        method: "TCP",
        status: "UP",
        latencyMs: latency,
        errorMessage: null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const pingResult = await tryPingFallback();
  if (pingResult) {
    return pingResult;
  }

  return {
    status: "DOWN",
    latencyMs: null,
    errorMessage: lastError,
    method: "TCP",
  };
}
