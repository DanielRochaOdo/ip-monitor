import dotenv from "dotenv";
dotenv.config();

import { getEnv, getEnvInt, jitterMs, log, sleep, fetchJson } from "./util.js";
import type { AgentPullResponse, AgentMonitorReport, AgentDeviceMetricReport } from "./types.js";
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

async function runDeviceCheck(task: AgentPullResponse["devices"][number], timeoutMs: number): Promise<AgentDeviceMetricReport> {
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

async function runCycle() {
  const appUrl = getEnv("APP_URL");
  const agentToken = getEnv("AGENT_TOKEN");
  const timeoutMs = getEnvInt("AGENT_TIMEOUT_MS", 2500);
  const concurrency = getEnvInt("AGENT_CONCURRENCY", 10);
  const dryRun = (process.env.AGENT_DRY_RUN ?? "").toLowerCase() === "true";

  const pull = await fetchJson<AgentPullResponse>(`${appUrl.replace(/\/$/, "")}/api/agent/pull`, {
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
    return;
  }

  const nowMs = Date.now();

  const monitors = (pull.data.monitors ?? []).filter((m) => !shouldSkip(`m:${m.id}`, nowMs));
  const devices = (pull.data.devices ?? []).filter((d) => !shouldSkip(`d:${d.id}`, nowMs));

  const monitorReports = await mapWithConcurrency(monitors, concurrency, async (m) => {
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

  const deviceReports = await mapWithConcurrency(devices, Math.min(concurrency, 5), async (d) => {
    const key = `d:${d.id}`;
    try {
      const r = await runDeviceCheck(d, timeoutMs);
      recordResult(key, r.status !== "DOWN", nowMs);
      return r;
    } catch (e) {
      recordResult(key, false, nowMs);
      return {
        device_id: d.id,
        checked_at: new Date().toISOString(),
        reachable: false,
        status: "DOWN" as const,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  if (dryRun) {
    log("dry_run", { monitors: monitorReports.length, devices: deviceReports.length });
    return;
  }

  const report = await fetchJson<any>(`${appUrl.replace(/\/$/, "")}/api/agent/report`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-token": agentToken,
    },
    body: JSON.stringify({ monitors: monitorReports, device_metrics: deviceReports }),
    timeoutMs: Math.max(7000, timeoutMs * 4),
  });

  if (!report.ok) {
    log("report_failed", { status: report.status, text: report.text });
    return;
  }

  log("cycle_ok", {
    monitors_pulled: pull.data.monitors?.length ?? 0,
    devices_pulled: pull.data.devices?.length ?? 0,
    monitors_reported: monitorReports.length,
    devices_reported: deviceReports.length,
    notifications_sent: report.data?.notificationsSent ?? 0,
  });
}

async function main() {
  const intervalSeconds = getEnvInt("AGENT_INTERVAL_SECONDS", 60);
  log("agent_start", { interval_seconds: intervalSeconds });

  for (;;) {
    const start = Date.now();
    await sleep(jitterMs(5000));
    try {
      await runCycle();
    } catch (e) {
      log("cycle_error", { error: e instanceof Error ? e.message : String(e) });
    }
    const elapsed = Date.now() - start;
    const waitMs = Math.max(0, intervalSeconds * 1000 - elapsed);
    await sleep(waitMs);
  }
}

main().catch((e) => {
  log("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
