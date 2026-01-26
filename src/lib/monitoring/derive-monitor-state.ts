import type { Database } from "@/types/database.types";

type MonitorRow = Database["public"]["Tables"]["monitors"]["Row"];

export type DerivedMonitorState = {
  effectiveStatus: "UP" | "DOWN";
  surfaceStatus: "UP" | "DOWN" | "DEGRADED";
  failureCount: number;
  successCount: number;
};

export function deriveMonitorState(opts: {
  monitor: MonitorRow;
  checkStatus: "UP" | "DOWN" | "DEGRADED";
}) : DerivedMonitorState {
  const { monitor, checkStatus } = opts;

  const failureThreshold = Math.max(1, monitor.failure_threshold ?? 2);
  const successThreshold = Math.max(1, monitor.success_threshold ?? 1);

  const prevEffective = monitor.last_status ?? "UP";
  let failureCount = monitor.failure_count ?? 0;
  let successCount = monitor.success_count ?? 0;

  // Surface status is what we want to show (ex.: reachable but service refused).
  const surfaceStatus = checkStatus;

  if (checkStatus === "UP" || checkStatus === "DEGRADED") {
    failureCount = 0;
    successCount = successCount + 1;

    if (prevEffective === "DOWN" && successCount >= successThreshold) {
      return { effectiveStatus: "UP", surfaceStatus, failureCount, successCount };
    }
    return { effectiveStatus: prevEffective, surfaceStatus, failureCount, successCount };
  }

  // DOWN
  successCount = 0;
  failureCount = failureCount + 1;

  if (prevEffective === "UP" && failureCount >= failureThreshold) {
    return { effectiveStatus: "DOWN", surfaceStatus, failureCount, successCount };
  }

  return { effectiveStatus: prevEffective, surfaceStatus, failureCount, successCount };
}

