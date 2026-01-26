import type { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildDownEmail, buildUpEmail, type MonitorCheckSummary } from "@/lib/email/templates";
import { sendMonitorEmail } from "@/lib/email/send";

type MonitorRow = Database["public"]["Tables"]["monitors"]["Row"];
type NotificationSettingsRow = Database["public"]["Tables"]["notification_settings"]["Row"];

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);

export type MonitorAlertCaches = {
  settingsCache: Map<string, NotificationSettingsRow>;
  emailCache: Map<string, string>;
};

export async function fetchUserSettings(userId: string, cache: Map<string, NotificationSettingsRow>) {
  if (cache.has(userId)) {
    return cache.get(userId)!;
  }
  const { data } = await supabaseAdmin
    .from("notification_settings")
    .select("*")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  const settings = data as unknown as NotificationSettingsRow | null;
  if (settings) {
    cache.set(userId, settings);
  }
  return settings;
}

export async function fetchUserEmail(userId: string, cache: Map<string, string>) {
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

export async function gatherRecentChecks(monitorId: string) {
  const { data } = await supabaseAdmin
    .from("monitor_checks")
    .select("checked_at, status, latency_ms, error_message")
    .eq("monitor_id", monitorId)
    .order("checked_at", { ascending: false })
    .limit(5);

  const rows = (data ?? []) as unknown as Array<{
    checked_at: string;
    status: "UP" | "DOWN" | "DEGRADED";
    latency_ms: number | null;
    error_message: string | null;
  }>;

  return rows.map(
    (row): MonitorCheckSummary => ({
      checkedAt: row.checked_at,
      status: row.status,
      latencyMs: row.latency_ms,
      errorMessage: row.error_message,
    }),
  );
}

export async function insertIncident(monitorId: string, startedAt: string) {
  await supabaseAdmin.from("monitor_incidents").insert({
    monitor_id: monitorId,
    started_at: startedAt,
    created_at: startedAt,
    updated_at: startedAt,
  });
}

export async function resolveIncident(monitorId: string, resolvedAt: string) {
  const { data } = await supabaseAdmin
    .from("monitor_incidents")
    .select("id")
    .eq("monitor_id", monitorId)
    .is("resolved_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.id) {
    await supabaseAdmin
      .from("monitor_incidents")
      .update({
        resolved_at: resolvedAt,
        updated_at: resolvedAt,
      })
      .eq("id", data.id);
  }
}

export async function notifyIfStateChanged(opts: {
  monitor: MonitorRow;
  previousEffectiveStatus: "UP" | "DOWN";
  derivedStatus: "UP" | "DOWN";
  occurredAt: string;
  dashboardUrl: string;
  caches: MonitorAlertCaches;
}) {
  const { monitor, previousEffectiveStatus, derivedStatus, occurredAt, dashboardUrl, caches } = opts;

  if (derivedStatus === previousEffectiveStatus) {
    return {
      notificationsSent: 0,
      incidentsCreated: 0,
      incidentsResolved: 0,
      errors: [] as string[],
    };
  }

  const report = {
    notificationsSent: 0,
    incidentsCreated: 0,
    incidentsResolved: 0,
    errors: [] as string[],
  };

  if (derivedStatus === "DOWN") {
    await insertIncident(monitor.id, occurredAt);
    report.incidentsCreated += 1;
  } else {
    await resolveIncident(monitor.id, occurredAt);
    report.incidentsResolved += 1;
  }

  const settings = await fetchUserSettings(monitor.user_id, caches.settingsCache);
  const destinationEmail = settings?.alert_email ?? (await fetchUserEmail(monitor.user_id, caches.emailCache));

  if (!destinationEmail) {
    return report;
  }

  const shouldNotify =
    (derivedStatus === "DOWN" && (settings?.notify_on_down ?? true)) ||
    (derivedStatus === "UP" && (settings?.notify_on_up ?? true));

  if (!shouldNotify) {
    return report;
  }

  const recentChecks = await gatherRecentChecks(monitor.id);
  const emailPayload =
    derivedStatus === "DOWN"
      ? buildDownEmail({
          nickname: monitor.nickname,
          ip: monitor.ip_address,
          dashboardUrl,
          occurredAt,
          checks: recentChecks,
        })
      : buildUpEmail({
          nickname: monitor.nickname,
          ip: monitor.ip_address,
          dashboardUrl,
          occurredAt,
          checks: recentChecks,
        });

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

  return report;
}

