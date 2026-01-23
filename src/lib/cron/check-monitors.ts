import { Database } from "@/lib/supabase/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runTcpHealthCheck } from "@/lib/network/check-monitor";
import { buildDownEmail, buildUpEmail, MonitorCheckSummary } from "@/lib/email/templates";
import { sendMonitorEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/env";

type MonitorRow = Database["public"]["Tables"]["monitors"]["Row"];
type NotificationSettingsRow = Database["public"]["Tables"]["notification_settings"]["Row"];

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

async function fetchUserSettings(userId: string, cache: Map<string, NotificationSettingsRow>) {
  if (cache.has(userId)) {
    return cache.get(userId)!;
  }
  const { data } = await supabaseAdmin
    .from("notification_settings")
    .select("*")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (data) {
    cache.set(userId, data);
  }
  return data;
}

async function fetchUserEmail(userId: string, cache: Map<string, string>) {
  if (cache.has(userId)) {
    return cache.get(userId)!;
  }

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) {
    return null;
  }

  const email = data.user?.email ?? null;
  if (email) {
    cache.set(userId, email);
  }
  return email;
}

async function gatherRecentChecks(monitorId: string) {
  const { data } = await supabaseAdmin
    .from("monitor_checks")
    .select("checked_at, status, latency_ms, error_message")
    .eq("monitor_id", monitorId)
    .order("checked_at", { ascending: false })
    .limit(5);
  return (data ?? []).map(
    (row): MonitorCheckSummary => ({
      checkedAt: row.checked_at,
      status: row.status,
      latencyMs: row.latency_ms,
      errorMessage: row.error_message,
    }),
  );
}

async function insertIncident(monitorId: string, startedAt: string) {
  await supabaseAdmin.from("monitor_incidents").insert({
    monitor_id: monitorId,
    started_at: startedAt,
    created_at: startedAt,
    updated_at: startedAt,
  });
}

async function resolveIncident(monitorId: string, resolvedAt: string) {
  const { data } = await supabaseAdmin
    .from("monitor_incidents")
    .select("id")
    .eq("monitor_id", monitorId)
    .is("resolved_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.id) {
    await supabaseAdmin.from("monitor_incidents").update({
      resolved_at: resolvedAt,
      updated_at: resolvedAt,
    }).eq("id", data.id);
  }
}

function shouldMarkDown(checkResult: "UP" | "DOWN", monitor: MonitorRow, recentChecks: { status: "UP" | "DOWN" }[]) {
  if (checkResult === "UP") return false;
  if (monitor.last_status === "DOWN") return true;

  const threshold = Math.max(1, monitor.failure_threshold ?? 2);
  if (threshold <= 1) return true;

  const required = threshold - 1;
  if (recentChecks.length < required) return false;

  return recentChecks.slice(0, required).every((check) => check.status === "DOWN");
}

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
    .lte("next_check_at", new Date().toISOString())
    .order("next_check_at", { ascending: true });

  if (error) {
    throw error;
  }

  const monitors = monitorsData ?? [];
  const settingsCache = new Map<string, NotificationSettingsRow>();
  const emailCache = new Map<string, string>();

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
      const thresholdLimit = Math.max(0, (monitor.failure_threshold ?? 2) - 1);
      const history =
        thresholdLimit > 0
          ? (await supabaseAdmin
              .from("monitor_checks")
              .select("status")
              .eq("monitor_id", monitor.id)
              .order("checked_at", { ascending: false })
              .limit(thresholdLimit)).data ?? []
          : [];

      const checkResult = await runTcpHealthCheck(monitor.ip_address, monitor.ports);

      await supabaseAdmin.from("monitor_checks").insert({
        monitor_id: monitor.id,
        checked_at: now,
        status: checkResult.status,
        latency_ms: checkResult.latencyMs,
        error_message: checkResult.errorMessage,
      });

      const shouldDown = shouldMarkDown(
        checkResult.status,
        monitor,
        history.map((row) => ({ status: row.status })),
      );
      const derivedStatus =
        checkResult.status === "UP" ? "UP" : shouldDown ? "DOWN" : monitor.last_status ?? "UP";

      const previousEffectiveStatus = monitor.last_status ?? "UP";
      const stateChanged = derivedStatus !== previousEffectiveStatus;

      const monitorUpdates: Partial<MonitorRow> = {
        updated_at: now,
        last_checked_at: now,
        next_check_at: nextCheckAt,
      };

      if (derivedStatus !== monitor.last_status) {
        monitorUpdates.last_status = derivedStatus as MonitorRow["last_status"];
      }

      await supabaseAdmin.from("monitors").update(monitorUpdates).eq("id", monitor.id);

      if (stateChanged) {
        if (derivedStatus === "DOWN") {
          await insertIncident(monitor.id, now);
          report.incidentsCreated += 1;
        } else if (derivedStatus === "UP") {
          await resolveIncident(monitor.id, now);
          report.incidentsResolved += 1;
        }

        const settings = await fetchUserSettings(monitor.user_id, settingsCache);
        const destinationEmail =
          settings?.alert_email ?? (await fetchUserEmail(monitor.user_id, emailCache));

        if (destinationEmail) {
          const recentChecks = await gatherRecentChecks(monitor.id);
          const emailPayload =
            derivedStatus === "DOWN"
              ? buildDownEmail({
                  nickname: monitor.nickname,
                  ip: monitor.ip_address,
                  dashboardUrl,
                  occurredAt: now,
                  checks: recentChecks,
                })
              : buildUpEmail({
                  nickname: monitor.nickname,
                  ip: monitor.ip_address,
                  dashboardUrl,
                  occurredAt: now,
                  checks: recentChecks,
                });

          const shouldNotify =
            (derivedStatus === "DOWN" && (settings?.notify_on_down ?? true)) ||
            (derivedStatus === "UP" && (settings?.notify_on_up ?? true));

          if (shouldNotify) {
            try {
              await sendMonitorEmail({
                to: destinationEmail,
                subject: emailPayload.subject,
                html: emailPayload.html,
              });
              report.notificationsSent += 1;
            } catch (sendError) {
              report.errors.push(`email failed for ${monitor.id}: ${toErrorMessage(sendError)}`);
            }
          }
        }
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
