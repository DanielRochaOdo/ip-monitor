import dotenv from "dotenv";
dotenv.config();

import { getEnv, getEnvInt, jitterMs, log, sleep, fetchJson } from "./util.js";
import type {
  AgentPullResponse,
  AgentMonitorReport,
  AgentDeviceMetricReport,
  AgentDeviceBackoffReport,
} from "./types.js";
import { icmpPing } from "./checks/icmp.js";
import { tcpCheck } from "./checks/tcp.js";
import { httpCheck } from "./checks/http.js";
import { collectFortiGateApiMetrics } from "./fortigate/api.js";
import { collectFortiGateSnmpMetrics } from "./fortigate/snmp.js";

type CircuitState = {
  failStreak: number;
  cooldownUntil: number;
};

const circuitByKey = new Map<string, CircuitState>();
const deviceSchedule = new Map<
  string,
  {
    nextRunAtMs: number;
    backoffSeconds: number;
    nextAllowedAtMs: number;
    reason: string | null;
    lastStatusAtMs: number;
    // Cache last successful metrics so we don't wipe the dashboard when we hit 429.
    lastGood: Partial<AgentDeviceMetricReport> | null;
  }
>();

function shouldSkip(key: string, nowMs: number) {
  const state = circuitByKey.get(key);
  if (!state) return false;
  return nowMs < state.cooldownUntil;
}

function recordResult(key: string, ok: boolean, nowMs: number) {
  const state = circuitByKey.get(key) ?? { failStreak: 0, cooldownUntil: 0 };
  if (ok) {
    state.failStreak = 0;
    state.cooldownUntil = 0;
  } else {
    state.failStreak += 1;
    if (state.failStreak >= 3) {
      // Backoff to 180s after repeated failures.
      state.cooldownUntil = nowMs + 180_000;
    }
  }
  circuitByKey.set(key, state);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

async function runMonitorCheck(task: AgentPullResponse["monitors"][number], timeoutMs: number): Promise<AgentMonitorReport> {
  const checkedAt = new Date().toISOString();
  const ip = task.ip_address;

  if (task.check_type === "ICMP") {
    const r = await icmpPing(ip, timeoutMs);
    return {
      id: task.id,
      checked_at: checkedAt,
      status: r.ok ? "UP" : "DOWN",
      latency_ms: r.latencyMs,
      error_message: r.error,
      check_method: "ICMP",
    };
  }

  if (task.check_type === "HTTP") {
    const url = task.http_url?.trim();
    if (!url) {
      return {
        id: task.id,
        checked_at: checkedAt,
        status: "DOWN",
        latency_ms: null,
        error_message: "missing http_url",
        check_method: "HTTP",
      };
    }
    const r = await httpCheck({
      url,
      method: task.http_method ?? "GET",
      expectedStatus: task.http_expected_status ?? 200,
      timeoutMs,
    });
    return {
      id: task.id,
      checked_at: checkedAt,
      status: r.status,
      latency_ms: r.latencyMs,
      error_message: r.error,
      check_method: "HTTP",
    };
  }

  // TCP
  const ports = [task.port].filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  const fallbackPorts = Array.isArray(task.ports) ? task.ports : [];
  const portsToTry = ports.length ? ports : fallbackPorts.length ? fallbackPorts : [443, 80];
  const r = await tcpCheck(ip, portsToTry, timeoutMs);
  return {
    id: task.id,
    checked_at: checkedAt,
    status: r.status,
    latency_ms: r.latencyMs,
    error_message: r.error,
    check_method: "TCP",
  };
}

async function runDeviceCheck(
  task: AgentPullResponse["devices"][number],
  timeoutMs: number,
  opts: { includeStatus?: boolean } = {},
): Promise<AgentDeviceMetricReport> {
  const checkedAt = new Date().toISOString();

  if (task.mgmt_method === "API") {
    const metrics = await collectFortiGateApiMetrics(
      {
        id: task.id,
        site: task.site,
        hostname: task.hostname,
        wan_public_ips: task.wan_public_ips ?? [],
        lan_ip: task.lan_ip,
        mgmt_port: task.mgmt_port,
        api_base_url: task.api_base_url,
        api_token_secret_ref: task.api_token_secret_ref,
      },
      { timeoutMs, includeStatus: opts.includeStatus ?? false },
    );

    return {
      device_id: task.id,
      checked_at: checkedAt,
      reachable: metrics.reachable,
      status: metrics.status,
      uptime_seconds: metrics.uptimeSeconds,
      cpu_percent: metrics.cpuPercent,
      mem_percent: metrics.memPercent,
      sessions: metrics.sessions,
      wan1_status: metrics.wan1Status,
      wan1_ip: metrics.wan1Ip,
      wan2_status: metrics.wan2Status,
      wan2_ip: metrics.wan2Ip,
      lan_status: metrics.lanStatus,
      lan_ip: metrics.lanIp,
      rx_bps: null,
      tx_bps: null,
      error: metrics.error,
    };
  }

  if (task.mgmt_method === "SNMP") {
    const metrics = await collectFortiGateSnmpMetrics(
      { lan_ip: task.lan_ip, snmp_target: task.snmp_target, snmp_community: task.snmp_community },
      { timeoutMs },
    );

    return {
      device_id: task.id,
      checked_at: checkedAt,
      reachable: metrics.reachable,
      status: metrics.status,
      uptime_seconds: metrics.uptimeSeconds,
      cpu_percent: metrics.cpuPercent,
      mem_percent: metrics.memPercent,
      sessions: null,
      wan1_status: null,
      wan1_ip: null,
      wan2_status: null,
      wan2_ip: null,
      lan_status: null,
      lan_ip: task.lan_ip,
      rx_bps: null,
      tx_bps: null,
      error: metrics.error,
    };
  }

  // TCP_ONLY
  const ip = task.lan_ip ?? "";
  if (!ip) {
    return {
      device_id: task.id,
      checked_at: checkedAt,
      reachable: false,
      status: "DOWN",
      error: "missing lan_ip",
    };
  }
  const r = await tcpCheck(ip, [task.mgmt_port], timeoutMs);
  return {
    device_id: task.id,
    checked_at: checkedAt,
    reachable: r.status !== "DOWN",
    status: r.status,
    error: r.error,
  };
}

async function sendReport(payload: {
  monitors?: AgentMonitorReport[];
  device_metrics?: AgentDeviceMetricReport[];
  device_backoff?: AgentDeviceBackoffReport[];
}) {
  const appUrl = getEnv("APP_URL");
  const agentToken = getEnv("AGENT_TOKEN");
  const timeoutMs = getEnvInt("AGENT_TIMEOUT_MS", 2500);
  const dryRun = (process.env.AGENT_DRY_RUN ?? "").toLowerCase() === "true";

  if (dryRun) {
    log("dry_run", { monitors: payload.monitors?.length ?? 0, devices: payload.device_metrics?.length ?? 0 });
    return;
  }

  const report = await fetchJson<any>(`${appUrl.replace(/\/$/, "")}/api/agent/report`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-token": agentToken,
    },
    body: JSON.stringify(payload),
    timeoutMs: Math.max(7000, timeoutMs * 4),
  });

  if (!report.ok) {
    log("report_failed", { status: report.status, text: report.text });
    return;
  }
}

async function main() {
  const appUrl = getEnv("APP_URL").replace(/\/$/, "");
  const agentToken = getEnv("AGENT_TOKEN");

  // Poll monitors separately (60s) so monitor intervals in DB are respected.
  const monitorPollSeconds = getEnvInt("AGENT_MONITOR_POLL_SECONDS", 60);
  // Device metrics interval defaults to 5 minutes to avoid API rate-limit bursts.
  const deviceIntervalSeconds = getEnvInt(
    "AGENT_DEVICE_INTERVAL_SECONDS",
    getEnvInt("AGENT_INTERVAL_SECONDS", 300),
  );

  const timeoutMs = getEnvInt("AGENT_TIMEOUT_MS", 2500);
  const deviceTimeoutMs = getEnvInt("AGENT_DEVICE_TIMEOUT_MS", Math.max(timeoutMs, 8000));
  const deviceStatusIntervalSeconds = getEnvInt("AGENT_DEVICE_STATUS_INTERVAL_SECONDS", 86400);

  const monitorConcurrency = getEnvInt("AGENT_CONCURRENCY", 2);
  const deviceConcurrency = getEnvInt("AGENT_DEVICE_CONCURRENCY", 1);

  log("agent_start", {
    monitor_poll_seconds: monitorPollSeconds,
    device_interval_seconds: deviceIntervalSeconds,
    monitor_concurrency: monitorConcurrency,
    device_concurrency: deviceConcurrency,
    device_status_interval_seconds: deviceStatusIntervalSeconds,
  });

  let lastPullAtMs = 0;
  let devices: AgentPullResponse["devices"] = [];

  for (;;) {
    const nowMs = Date.now();

    // Pull due monitors and refresh device list/backoff periodically.
    if (nowMs - lastPullAtMs >= monitorPollSeconds * 1000) {
      lastPullAtMs = nowMs;

      const pull = await fetchJson<AgentPullResponse>(`${appUrl}/api/agent/pull`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agent-token": agentToken,
        },
        body: JSON.stringify({}),
        timeoutMs: Math.max(5000, timeoutMs * 2),
      });

      if (!pull.ok || !pull.data) {
        log("pull_failed", { status: pull.status, text: pull.text });
      } else {
        devices = pull.data.devices ?? [];

        // Merge persisted backoff state.
        const backoffRows = pull.data.device_backoff ?? [];
        for (const row of backoffRows) {
          const deviceId = row.device_id;
          const nextAllowedAtMs = row.next_allowed_at ? new Date(row.next_allowed_at).getTime() : 0;
          const existing = deviceSchedule.get(deviceId);
          deviceSchedule.set(deviceId, {
            nextRunAtMs: existing?.nextRunAtMs ?? nowMs + jitterMs(3000),
            backoffSeconds: row.backoff_seconds ?? 0,
            nextAllowedAtMs: Number.isFinite(nextAllowedAtMs) ? nextAllowedAtMs : 0,
            reason: row.reason ?? null,
            lastStatusAtMs: existing?.lastStatusAtMs ?? 0,
            lastGood: existing?.lastGood ?? null,
          });
        }

        // Seed schedules for newly discovered devices (spread across the interval).
        const spreadMs = Math.max(1, Math.floor((deviceIntervalSeconds * 1000) / Math.max(1, devices.length)));
        devices.forEach((d, idx) => {
          if (deviceSchedule.has(d.id)) return;
          deviceSchedule.set(d.id, {
            nextRunAtMs: nowMs + idx * spreadMs + jitterMs(3000),
            backoffSeconds: 0,
            nextAllowedAtMs: 0,
            reason: null,
            lastStatusAtMs: 0,
            lastGood: null,
          });
        });

        const dueMonitors = (pull.data.monitors ?? []).filter((m) => !shouldSkip(`m:${m.id}`, nowMs));
        if (dueMonitors.length) {
          const monitorReports = await mapWithConcurrency(dueMonitors, monitorConcurrency, async (m) => {
            const key = `m:${m.id}`;
            try {
              const r = await runMonitorCheck(m, timeoutMs);
              recordResult(key, r.status !== "DOWN", nowMs);
              return r;
            } catch (e) {
              recordResult(key, false, nowMs);
              return {
                id: m.id,
                checked_at: new Date().toISOString(),
                status: "DOWN" as const,
                latency_ms: null,
                error_message: e instanceof Error ? e.message : String(e),
                check_method: "TCP" as const,
              };
            }
          });

          await sendReport({ monitors: monitorReports });
        }
      }
    }

    // Process devices that are due; keep device concurrency low and add per-device jitter.
    const dueDevices = devices
      .map((d) => ({ d, s: deviceSchedule.get(d.id) }))
      .filter(({ s }) => !!s)
      .filter(({ d, s }) => !shouldSkip(`d:${d.id}`, nowMs) && nowMs >= (s!.nextRunAtMs ?? 0))
      .filter(({ s }) => !s!.nextAllowedAtMs || nowMs >= s!.nextAllowedAtMs)
      .sort((a, b) => (a.s!.nextRunAtMs ?? 0) - (b.s!.nextRunAtMs ?? 0))
      .slice(0, Math.max(1, deviceConcurrency))
      .map(({ d }) => d);

    if (dueDevices.length) {
      const deviceReports: AgentDeviceMetricReport[] = [];
      const backoffUpdates: AgentDeviceBackoffReport[] = [];

      for (const device of dueDevices) {
        const state = deviceSchedule.get(device.id)!;
        await sleep(jitterMs(3000));

        const key = `d:${device.id}`;
        try {
          const includeStatus = nowMs - state.lastStatusAtMs >= deviceStatusIntervalSeconds * 1000;
          const r = await runDeviceCheck(device, deviceTimeoutMs, { includeStatus });
          recordResult(key, r.status !== "DOWN", nowMs);

          // If we attempted the static "status" call, don't keep hammering it on failures.
          if (includeStatus) {
            state.lastStatusAtMs = nowMs;
          }

          // Detect FortiGate rate-limit in a stable way.
          const is429 =
            r.status === "DEGRADED" &&
            typeof r.error === "string" &&
            r.error.startsWith("rate limited by FortiGate (429)");
          if (is429) {
            // Keep last good values in the row so the UI stays useful during backoff.
            const merged: AgentDeviceMetricReport = {
              ...r,
              uptime_seconds: state.lastGood?.uptime_seconds ?? r.uptime_seconds ?? null,
              cpu_percent: state.lastGood?.cpu_percent ?? r.cpu_percent ?? null,
              mem_percent: state.lastGood?.mem_percent ?? r.mem_percent ?? null,
              sessions: state.lastGood?.sessions ?? r.sessions ?? null,
              wan1_status: state.lastGood?.wan1_status ?? r.wan1_status ?? null,
              wan2_status: state.lastGood?.wan2_status ?? r.wan2_status ?? null,
              lan_status: state.lastGood?.lan_status ?? r.lan_status ?? null,
              wan1_ip: state.lastGood?.wan1_ip ?? r.wan1_ip ?? null,
              wan2_ip: state.lastGood?.wan2_ip ?? r.wan2_ip ?? null,
              lan_ip: state.lastGood?.lan_ip ?? r.lan_ip ?? null,
            };
            deviceReports.push(merged);

            const nextBackoff = Math.min(state.backoffSeconds ? state.backoffSeconds * 2 : 60, 300);
            const nextAllowedAtMs = nowMs + nextBackoff * 1000;
            state.backoffSeconds = nextBackoff;
            state.nextAllowedAtMs = nextAllowedAtMs;
            state.reason = "429";
            state.nextRunAtMs = nextAllowedAtMs + jitterMs(3000);
            backoffUpdates.push({
              device_id: device.id,
              backoff_seconds: nextBackoff,
              next_allowed_at: new Date(nextAllowedAtMs).toISOString(),
              reason: "429 rate limit",
            });
            log("device_backoff", { device_id: device.id, site: device.site, backoff_seconds: nextBackoff });
          } else {
            deviceReports.push(r);

            // Cache last successful metric payload for resilience.
            if (r.status !== "DOWN") {
              state.lastGood = {
                uptime_seconds: r.uptime_seconds ?? null,
                cpu_percent: r.cpu_percent ?? null,
                mem_percent: r.mem_percent ?? null,
                sessions: r.sessions ?? null,
                wan1_status: r.wan1_status ?? null,
                wan2_status: r.wan2_status ?? null,
                lan_status: r.lan_status ?? null,
                wan1_ip: r.wan1_ip ?? null,
                wan2_ip: r.wan2_ip ?? null,
                lan_ip: r.lan_ip ?? null,
              };
            }

            // Clear backoff on successful/non-429 attempts.
            if (state.backoffSeconds || state.nextAllowedAtMs) {
              state.backoffSeconds = 0;
              state.nextAllowedAtMs = 0;
              state.reason = null;
              backoffUpdates.push({
                device_id: device.id,
                backoff_seconds: 0,
                next_allowed_at: null,
                reason: null,
              });
            }
            state.nextRunAtMs = nowMs + deviceIntervalSeconds * 1000 + jitterMs(3000);
          }
        } catch (e) {
          recordResult(key, false, nowMs);
          deviceReports.push({
            device_id: device.id,
            checked_at: new Date().toISOString(),
            reachable: false,
            status: "DOWN",
            error: e instanceof Error ? e.message : String(e),
          });
          state.nextRunAtMs = nowMs + deviceIntervalSeconds * 1000 + jitterMs(3000);
        }

        deviceSchedule.set(device.id, state);
      }

      await sendReport({ device_metrics: deviceReports, device_backoff: backoffUpdates });
    }

    await sleep(1000);
  }
}

main().catch((e) => {
  log("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
