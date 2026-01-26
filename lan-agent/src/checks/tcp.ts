import net from "node:net";

export type TcpStatus = "UP" | "DOWN" | "DEGRADED";

export type TcpResult = {
  status: TcpStatus;
  latencyMs: number | null;
  error: string | null;
};

async function attemptPort(ip: string, port: number, timeoutMs: number): Promise<TcpResult> {
  const started = Date.now();
  return new Promise<TcpResult>((resolve) => {
    const socket = new net.Socket();
    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      const latencyMs = Date.now() - started;
      cleanup();
      resolve({ status: "UP", latencyMs, error: null });
    });

    socket.once("timeout", () => {
      cleanup();
      resolve({ status: "DOWN", latencyMs: null, error: "tcp timeout" });
    });

    socket.once("error", (err) => {
      const errno = err as NodeJS.ErrnoException;
      const latencyMs = Date.now() - started;
      cleanup();
      if (errno?.code === "ECONNREFUSED") {
        // Host reachable but port closed.
        resolve({ status: "DEGRADED", latencyMs, error: "tcp refused" });
        return;
      }
      resolve({ status: "DOWN", latencyMs: null, error: errno?.code ?? err.message });
    });

    socket.connect(port, ip);
  });
}

export async function tcpCheck(ip: string, ports: number[], timeoutMs = 2500): Promise<TcpResult & { portTried?: number }> {
  let refused: TcpResult | null = null;
  let lastDown: TcpResult | null = null;

  for (const port of ports) {
    // One retry on timeouts reduces false negatives on congested links.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await attemptPort(ip, port, timeoutMs);
      if (result.status === "UP") {
        return { ...result, portTried: port };
      }
      if (result.status === "DEGRADED") {
        refused = { ...result };
        break;
      }

      lastDown = result;
      if (result.error !== "tcp timeout") {
        break;
      }
    }
  }

  if (refused) {
    return { ...refused, portTried: ports[0] };
  }
  return { ...(lastDown ?? { status: "DOWN", latencyMs: null, error: "tcp failed" }), portTried: ports[0] };
}

