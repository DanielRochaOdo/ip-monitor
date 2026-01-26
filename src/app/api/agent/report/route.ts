import { NextResponse } from "next/server";
import { requireAgentFromRequest } from "@/app/api/agent/_lib";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveMonitorState } from "@/lib/monitoring/derive-monitor-state";
import { notifyIfStateChanged } from "@/lib/monitoring/alerts";
import type { Database } from "@/types/database.types";
import { getAppUrl } from "@/lib/env";

export const runtime = "nodejs";

type MonitorRow = Database["public"]["Tables"]["monitors"]["Row"];

type AgentMonitorReport = {
  id: string;
  checked_at?: string;
  status: "UP" | "DOWN" | "DEGRADED";
  latency_ms?: number | null;
  error_message?: string | null;
  check_method: "ICMP" | "TCP" | "HTTP";
};

type AgentDeviceMetricReport = {
  device_id: string;
  checked_at?: string;
  reachable: boolean;
  status: "UP" | "DOWN" | "DEGRADED";
  uptime_seconds?: number | null;
  cpu_percent?: number | null;
  mem_percent?: number | null;
  sessions?: number | null;
  wan1_status?: string | null;
  wan1_ip?: string | null;
  wan2_status?: string | null;
  wan2_ip?: string | null;
  lan_status?: string | null;
  lan_ip?: string | null;
  rx_bps?: number | null;
  tx_bps?: number | null;
  error?: string | null;
};

function toIso(value?: string) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function computeNextCheckAt(monitor: MonitorRow, checkedAtIso: string) {
  const intervalMs = monitor.ping_interval_seconds * 1000;
  const previousNextAt = monitor.next_check_at ? new Date(monitor.next_check_at).getTime() : Date.now();
  const checkedAtMs = new Date(checkedAtIso).getTime();
  let nextAtMs = previousNextAt + intervalMs;

  // If the agent was late (or restarted), keep scheduling from "now" to avoid a tight loop.
  if (!Number.isFinite(nextAtMs) || nextAtMs < checkedAtMs) {
    nextAtMs = checkedAtMs + intervalMs;
  }

  return new Date(nextAtMs).toISOString();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const queue = items.slice();
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) break;
      results.push(await fn(next));
    }
  });
  await Promise.all(workers);
  return results;
}

export async function POST(request: Request) {
  try {
    const agent = await requireAgentFromRequest(request);
    const payload = (await request.json()) as {
      monitors?: AgentMonitorReport[];
      device_metrics?: AgentDeviceMetricReport[];
    };

    const dashboardUrl = new URL("/dashboard", getAppUrl()).toString();
    const caches = {
      settingsCache: new Map<string, Database["public"]["Tables"]["notification_settings"]["Row"]>(),
      emailCache: new Map<string, string>(),
    };

    const monitorReports = Array.isArray(payload?.monitors) ? payload.monitors : [];
    const monitorIds = Array.from(new Set(monitorReports.map((item) => item.id).filter(Boolean)));

    const { data: monitorRows, error: monitorsError } = monitorIds.length
      ? await supabaseAdmin
          .from("monitors")
          .select("*")
          .in("id", monitorIds)
          .eq("agent_id", agent.id)
      : { data: [], error: null as null | { message: string } };

    if (monitorsError) {
      return NextResponse.json({ error: monitorsError.message }, { status: 500 });
    }

    const monitorMap = new Map<string, MonitorRow>();
    for (const row of (monitorRows ?? []) as unknown as MonitorRow[]) {
      monitorMap.set(row.id, row);
    }

    const monitorResults = await mapWithConcurrency(monitorReports, 10, async (report) => {
      const monitor = monitorMap.get(report.id);
      if (!monitor) {
        return { id: report.id, ok: false, error: "monitor nao pertence ao agente" };
      }

      const checkedAt = toIso(report.checked_at);
      const nextCheckAt = computeNextCheckAt(monitor, checkedAt);
      const derived = deriveMonitorState({ monitor, checkStatus: report.status });

      const previousEffectiveStatus = monitor.last_status ?? "UP";
      const derivedStatus = derived.effectiveStatus;

      // Insert history first; status is the surface status (UP/DOWN/DEGRADED).
      const { error: insertError } = await supabaseAdmin.from("monitor_checks").insert({
        monitor_id: monitor.id,
        checked_at: checkedAt,
        status: derived.surfaceStatus,
        latency_ms: report.latency_ms ?? null,
        error_message: report.error_message ?? null,
        source: "LAN",
        agent_id: agent.id,
        check_method: report.check_method,
      });

      if (insertError) {
        return { id: report.id, ok: false, error: insertError.message };
      }

      const monitorUpdates: Database["public"]["Tables"]["monitors"]["Update"] = {
        updated_at: checkedAt,
        last_checked_at: checkedAt,
        next_check_at: nextCheckAt,
        last_latency_ms: report.latency_ms ?? null,
        last_error: report.error_message ?? null,
        failure_count: derived.failureCount,
        success_count: derived.successCount,
        status: derived.surfaceStatus,
        last_status: derivedStatus,
      };

      const { error: updateError } = await supabaseAdmin.from("monitors").update(monitorUpdates).eq("id", monitor.id);
      if (updateError) {
        return { id: report.id, ok: false, error: updateError.message };
      }

      const alertReport = await notifyIfStateChanged({
        monitor,
        previousEffectiveStatus,
        derivedStatus,
        occurredAt: checkedAt,
        dashboardUrl,
        caches,
      });

      return { id: report.id, ok: true, alerts: alertReport };
    });

    const deviceReports = Array.isArray(payload?.device_metrics) ? payload.device_metrics : [];
    const deviceIds = Array.from(new Set(deviceReports.map((item) => item.device_id).filter(Boolean)));

    const { data: deviceRows, error: devicesError } = deviceIds.length
      ? await supabaseAdmin
          .from("network_devices")
          .select("id")
          .in("id", deviceIds)
          .eq("agent_id", agent.id)
      : { data: [], error: null as null | { message: string } };

    if (devicesError) {
      return NextResponse.json({ error: devicesError.message }, { status: 500 });
    }

    const deviceAllowed = new Set((deviceRows ?? []).map((row) => (row as { id: string }).id));
    const deviceRowsToInsert = deviceReports
      .filter((row) => deviceAllowed.has(row.device_id))
      .map((row) => ({
        device_id: row.device_id,
        agent_id: agent.id,
        checked_at: toIso(row.checked_at),
        reachable: row.reachable,
        status: row.status,
        uptime_seconds: row.uptime_seconds ?? null,
        cpu_percent: row.cpu_percent ?? null,
        mem_percent: row.mem_percent ?? null,
        sessions: row.sessions ?? null,
        wan1_status: row.wan1_status ?? null,
        wan1_ip: row.wan1_ip ?? null,
        wan2_status: row.wan2_status ?? null,
        wan2_ip: row.wan2_ip ?? null,
        lan_status: row.lan_status ?? null,
        lan_ip: row.lan_ip ?? null,
        rx_bps: row.rx_bps ?? null,
        tx_bps: row.tx_bps ?? null,
        error: row.error ?? null,
      }));

    if (deviceRowsToInsert.length) {
      await supabaseAdmin.from("device_metrics").insert(deviceRowsToInsert);
    }

    const notificationsSent = monitorResults.reduce(
      (acc, item) => acc + (item.ok ? (item.alerts?.notificationsSent ?? 0) : 0),
      0,
    );

    return NextResponse.json({
      ok: true,
      monitorsProcessed: monitorResults.length,
      notificationsSent,
      devicesProcessed: deviceRowsToInsert.length,
      monitorResults,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unauthorized";
    const status = message.includes("token") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

