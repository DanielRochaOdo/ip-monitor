import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runTcpHealthCheck } from "@/lib/network/check-monitor";
import { notifyIfStateChanged } from "@/lib/monitoring/alerts";
import { deriveMonitorState } from "@/lib/monitoring/derive-monitor-state";
import { getAppUrl } from "@/lib/env";

type MonitorRow = Database["public"]["Tables"]["monitors"]["Row"];

type CronReport = {
  checked: number;
  notificationsSent: number;
  incidentsCreated: number;
  incidentsResolved: number;
  errors: string[];
};

export type RunMonitorsResult = CronReport;

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);

export async function runMonitorChecks(): Promise<RunMonitorsResult> {
  const report: CronReport = {
    checked: 0,
    notificationsSent: 0,
    incidentsCreated: 0,
    incidentsResolved: 0,
    errors: [],
  };

  const dashboardUrl = new URL("/dashboard", getAppUrl()).toString();

  const { data: monitorsData, error } = await supabaseAdmin
    .from("monitors")
    .select("*")
    .eq("is_active", true)
    // LAN monitors (agent_id != null) are checked by the LAN Agent, not the cloud cron.
    .is("agent_id", null)
    .lte("next_check_at", new Date().toISOString())
    .order("next_check_at", { ascending: true });

  if (error) {
    throw error;
  }

  const monitors = (monitorsData ?? []) as unknown as MonitorRow[];
  const caches = {
    settingsCache: new Map<string, Database["public"]["Tables"]["notification_settings"]["Row"]>(),
    emailCache: new Map<string, string>(),
  };

  for (const monitor of monitors) {
    const now = new Date().toISOString();
    // Keep cadence based on the previously scheduled time when possible (reduces drift when the cron runs late).
    const intervalMs = monitor.ping_interval_seconds * 1000;
    const previousNextAt = monitor.next_check_at ? new Date(monitor.next_check_at).getTime() : Date.now();
    let nextAtMs = previousNextAt + intervalMs;
    if (!Number.isFinite(nextAtMs) || nextAtMs < Date.now()) {
      nextAtMs = Date.now() + intervalMs;
    }
    const nextCheckAt = new Date(nextAtMs).toISOString();

    try {
      const checkResult = await runTcpHealthCheck(monitor.ip_address, monitor.ports);
      const derived = deriveMonitorState({ monitor, checkStatus: checkResult.status });

      await supabaseAdmin.from("monitor_checks").insert({
        monitor_id: monitor.id,
        checked_at: now,
        status: derived.surfaceStatus,
        latency_ms: checkResult.latencyMs,
        error_message: checkResult.errorMessage,
        source: "CLOUD",
        agent_id: null,
        check_method: checkResult.method,
      });

      const previousEffectiveStatus = monitor.last_status ?? "UP";
      const derivedStatus = derived.effectiveStatus;
      const stateChanged = derivedStatus !== previousEffectiveStatus;

      const monitorUpdates: Partial<MonitorRow> = {
        updated_at: now,
        last_checked_at: now,
        next_check_at: nextCheckAt,
        last_latency_ms: checkResult.latencyMs,
        last_error: checkResult.errorMessage,
        failure_count: derived.failureCount,
        success_count: derived.successCount,
        status: derived.surfaceStatus,
      };

      monitorUpdates.last_status = derivedStatus as MonitorRow["last_status"];

      await supabaseAdmin.from("monitors").update(monitorUpdates).eq("id", monitor.id);

      if (stateChanged) {
        const alertReport = await notifyIfStateChanged({
          monitor,
          previousEffectiveStatus,
          derivedStatus,
          occurredAt: now,
          dashboardUrl,
          caches,
        });
        report.notificationsSent += alertReport.notificationsSent;
        report.incidentsCreated += alertReport.incidentsCreated;
        report.incidentsResolved += alertReport.incidentsResolved;
        report.errors.push(...alertReport.errors);
      }

      report.checked += 1;
    } catch (error: unknown) {
      report.errors.push(`monitor ${monitor.id} check failed: ${toErrorMessage(error)}`);
      await supabaseAdmin
        .from("monitors")
        .update({ next_check_at: nextCheckAt, updated_at: new Date().toISOString() })
        .eq("id", monitor.id);
    }
  }

  return report;
}
