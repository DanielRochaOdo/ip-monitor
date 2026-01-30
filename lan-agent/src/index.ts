import dotenv from "dotenv";
dotenv.config();

import { getEnv, getEnvInt, jitterMs, log, sleep, fetchJson } from "./util.js";
import type {
  AgentPullResponse,
  AgentMonitorReport,
  AgentDeviceMetricReport,
  AgentDeviceBackoffReport,
  AgentDeviceRunRequestConsumedReport,
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

type DeviceOverrides = {
  stepSeconds: number;
  interfaceIntervalSeconds: number;
  statusIntervalSeconds: number;
  backoffCapSeconds: number;
  ifaceCooldownSeconds: number;
};

const circuitByKey = new Map<string, CircuitState>();
const deviceSchedule = new Map<
  string,
  {
    nextRunAtMs: number;
    backoffSeconds: number;
    nextAllowedAtMs: number;
    ifaceNextAllowedAtMs: number;
    reason: string | null;
    lastError: string | null;
    rateLimitCount: number;
    lastStatusAtMs: number;
    lastIfaceAtMs: number;
    lastPerfAtMs: number;
    lastRunAtMs: number;
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

function normalizeSiteKey(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function getDeviceOverrides(
  site: string,
  defaults: DeviceOverrides,
  device?: Partial<Pick<
    AgentPullResponse["devices"][number],
    | "step_seconds"
    | "interface_interval_seconds"
    | "status_interval_seconds"
    | "backoff_cap_seconds"
    | "iface_cooldown_seconds"
  >>,
): DeviceOverrides {
  const key = normalizeSiteKey(site);
  const byEnv = (suffix: string) => getEnvInt(`FGT_${key}_${suffix}`, 0);

  // Per-site overrides from env (if set).
  const stepOverride = byEnv("STEP_SECONDS");
  const ifaceOverride = byEnv("INTERFACE_INTERVAL_SECONDS");
  const statusOverride = byEnv("STATUS_INTERVAL_SECONDS");
  const backoffOverride = byEnv("BACKOFF_CAP_SECONDS");

  if (stepOverride || ifaceOverride || statusOverride || backoffOverride) {
    return {
      stepSeconds: stepOverride || defaults.stepSeconds,
      interfaceIntervalSeconds: ifaceOverride || defaults.interfaceIntervalSeconds,
      statusIntervalSeconds: statusOverride || defaults.statusIntervalSeconds,
      backoffCapSeconds: backoffOverride || defaults.backoffCapSeconds,
      ifaceCooldownSeconds: defaults.ifaceCooldownSeconds,
    };
  }

  // Per-device overrides from DB (if set).
  const stepDb = device?.step_seconds ?? null;
  const ifaceDb = device?.interface_interval_seconds ?? null;
  const statusDb = device?.status_interval_seconds ?? null;
  const backoffDb = device?.backoff_cap_seconds ?? null;
  const ifaceCooldownDb = device?.iface_cooldown_seconds ?? null;

  if (stepDb || ifaceDb || statusDb || backoffDb || ifaceCooldownDb) {
    return {
      stepSeconds: stepDb ?? defaults.stepSeconds,
      interfaceIntervalSeconds: ifaceDb ?? defaults.interfaceIntervalSeconds,
      statusIntervalSeconds: statusDb ?? defaults.statusIntervalSeconds,
      backoffCapSeconds: backoffDb ?? defaults.backoffCapSeconds,
      ifaceCooldownSeconds: ifaceCooldownDb ?? defaults.ifaceCooldownSeconds,
    };
  }

  // Hard defaults for sites known to be more aggressive with rate-limits.
  if (key === "AGUANAMBI" || key === "BEZERRA") {
    return {
      stepSeconds: Math.max(defaults.stepSeconds, 600),
      interfaceIntervalSeconds: Math.max(defaults.interfaceIntervalSeconds, 1800),
      statusIntervalSeconds: 0, // disable status endpoint (often 429)
      backoffCapSeconds: Math.max(defaults.backoffCapSeconds, 1800),
      ifaceCooldownSeconds: Math.max(defaults.ifaceCooldownSeconds, 1800),
    };
  }

  return defaults;
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
  opts: { mode?: "perf" | "iface" | "status" } = {},
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
      {
        timeoutMs,
        mode: opts.mode ?? "perf",
      },
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
  device_run_requests_consumed?: AgentDeviceRunRequestConsumedReport[];
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
  const timeoutMs = getEnvInt("AGENT_TIMEOUT_MS", 2500);
  const deviceTimeoutMs = getEnvInt("AGENT_DEVICE_TIMEOUT_MS", Math.max(timeoutMs, 8000));
  const deviceStatusIntervalSeconds = getEnvInt("AGENT_DEVICE_STATUS_INTERVAL_SECONDS", 86400);
  // Devices: avoid bursts by checking ONE device per step.
  // Default is 10 min per device. Use "Monitorar agora" for manual checks.
  const deviceStepSeconds = getEnvInt("AGENT_DEVICE_STEP_SECONDS", 600);
  // How often to call the interfaces endpoint per device (default 1h).
  const deviceInterfaceIntervalSeconds = getEnvInt("AGENT_DEVICE_INTERFACE_INTERVAL_SECONDS", 3600);
  const deviceBackoffCapSeconds = getEnvInt("AGENT_DEVICE_BACKOFF_CAP_SECONDS", 3600);
  const ifaceCooldownSeconds = getEnvInt("AGENT_DEVICE_IFACE_COOLDOWN_SECONDS", 3600);
  const deviceDefaults: DeviceOverrides = {
    stepSeconds: deviceStepSeconds,
    interfaceIntervalSeconds: deviceInterfaceIntervalSeconds,
    statusIntervalSeconds: deviceStatusIntervalSeconds,
    backoffCapSeconds: deviceBackoffCapSeconds,
    ifaceCooldownSeconds: ifaceCooldownSeconds,
  };

  const monitorConcurrency = getEnvInt("AGENT_CONCURRENCY", 1);
  // Kept for compatibility; this scheduler runs at most 1 device per step to avoid bursts.
  const deviceConcurrency = getEnvInt("AGENT_DEVICE_CONCURRENCY", 1);

  const availableTokenRefs = Object.keys(process.env).filter(
    (key) => key.startsWith("FGT_") && key.endsWith("_TOKEN"),
  );
  log("agent_config", {
    monitor_poll_seconds: monitorPollSeconds,
    device_step_seconds: deviceStepSeconds,
    device_interface_interval_seconds: deviceInterfaceIntervalSeconds,
    monitor_concurrency: monitorConcurrency,
    device_concurrency: deviceConcurrency,
    device_status_interval_seconds: deviceStatusIntervalSeconds,
    device_backoff_cap_seconds: deviceBackoffCapSeconds,
    iface_cooldown_seconds: ifaceCooldownSeconds,
    token_refs: availableTokenRefs,
  });

  log("agent_start", {
    monitor_poll_seconds: monitorPollSeconds,
    device_step_seconds: deviceStepSeconds,
    device_interface_interval_seconds: deviceInterfaceIntervalSeconds,
    monitor_concurrency: monitorConcurrency,
    device_concurrency: deviceConcurrency,
    device_status_interval_seconds: deviceStatusIntervalSeconds,
    device_backoff_cap_seconds: deviceBackoffCapSeconds,
    iface_cooldown_seconds: ifaceCooldownSeconds,
  });

  let lastPullAtMs = 0;
  let devices: AgentPullResponse["devices"] = [];
  let pendingDeviceRunRequests: NonNullable<AgentPullResponse["device_run_requests"]> = [];
  let deviceOrder: string[] = [];
  let deviceCursor = 0;
  let nextDeviceStepAtMs = 0;
  const missingTokenLogged = new Set<string>();

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
        for (const device of devices) {
          if (device.api_token) continue;
          const ref = device.api_token_secret_ref?.trim() ?? null;
          if (!ref) {
            const key = `${device.id}:missing-ref`;
            if (!missingTokenLogged.has(key)) {
              log("device_token_missing", { device_id: device.id, site: device.site, ref: null });
              missingTokenLogged.add(key);
            }
            continue;
          }
          if (!process.env[ref]) {
            const key = `${device.id}:${ref}`;
            if (!missingTokenLogged.has(key)) {
              log("device_token_missing", { device_id: device.id, site: device.site, ref });
              missingTokenLogged.add(key);
            }
          }
        }
        pendingDeviceRunRequests = (pull.data.device_run_requests ?? []).slice().sort((a, b) => {
          const ta = new Date(a.requested_at).getTime();
          const tb = new Date(b.requested_at).getTime();
          if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
          return ta - tb;
        });

        // Stable order so we don't burst on restarts: sort by site/name then round-robin.
        deviceOrder = devices
          .slice()
          .sort((a, b) => {
            const sa = `${a.site ?? ""} ${a.hostname ?? ""} ${a.id}`;
            const sb = `${b.site ?? ""} ${b.hostname ?? ""} ${b.id}`;
            return sa.localeCompare(sb);
          })
          .map((d) => d.id);
        if (deviceOrder.length && deviceCursor >= deviceOrder.length) deviceCursor = 0;
        if (!nextDeviceStepAtMs) nextDeviceStepAtMs = nowMs + jitterMs(1000);

        // Merge persisted backoff state.
        const backoffRows = pull.data.device_backoff ?? [];
        for (const row of backoffRows) {
          const deviceId = row.device_id;
          const nextAllowedAtMs = row.next_allowed_at ? new Date(row.next_allowed_at).getTime() : 0;
          const ifaceNextAllowedAtMs = row.iface_next_allowed_at ? new Date(row.iface_next_allowed_at).getTime() : 0;
          const existing = deviceSchedule.get(deviceId);
          deviceSchedule.set(deviceId, {
            nextRunAtMs: existing?.nextRunAtMs ?? nowMs + jitterMs(3000),
            backoffSeconds: row.backoff_seconds ?? 0,
            nextAllowedAtMs: Number.isFinite(nextAllowedAtMs) ? nextAllowedAtMs : 0,
            ifaceNextAllowedAtMs: Number.isFinite(ifaceNextAllowedAtMs) ? ifaceNextAllowedAtMs : 0,
            reason: row.reason ?? null,
            lastError: row.last_error ?? null,
            rateLimitCount: row.rate_limit_count ?? 0,
            lastStatusAtMs: existing?.lastStatusAtMs ?? 0,
            lastIfaceAtMs: existing?.lastIfaceAtMs ?? 0,
            lastPerfAtMs: existing?.lastPerfAtMs ?? 0,
            lastRunAtMs: existing?.lastRunAtMs ?? 0,
            lastGood: existing?.lastGood ?? null,
          });
        }

        // Seed schedules for newly discovered devices (spread across steps).
        const spreadMs = Math.max(1, deviceStepSeconds * 1000);
        devices.forEach((d, idx) => {
          if (deviceSchedule.has(d.id)) return;
          deviceSchedule.set(d.id, {
            nextRunAtMs: nowMs + idx * spreadMs + jitterMs(3000),
            backoffSeconds: 0,
            nextAllowedAtMs: 0,
            ifaceNextAllowedAtMs: 0,
            reason: null,
            lastError: null,
            rateLimitCount: 0,
            lastStatusAtMs: 0,
            lastIfaceAtMs: 0,
            lastPerfAtMs: 0,
            lastRunAtMs: 0,
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

    // If the user clicked "Monitorar agora", don't wait for the next step window.
    if (pendingDeviceRunRequests.length && nowMs < nextDeviceStepAtMs) {
      nextDeviceStepAtMs = nowMs;
    }

    // Devices: run ONE device per step to avoid bursts (round-robin).
    if (deviceOrder.length && nowMs >= nextDeviceStepAtMs) {
      nextDeviceStepAtMs = nowMs + deviceStepSeconds * 1000;

      // Intentionally clamp to 1 to guarantee "one device per minute" behavior.
      // (If you ever want more, raise AGENT_DEVICE_STEP_SECONDS instead of concurrency.)
      const runsThisStep = Math.min(1, Math.max(1, deviceConcurrency));

      // eslint-disable-next-line no-plusplus
      for (let run = 0; run < runsThisStep; run++) {
        // Priority: manual run requests (button "monitorar agora") from the dashboard.
        let selectedDevice: AgentPullResponse["devices"][number] | null = null;
        let selectedRequestId: string | null = null;

        for (const rr of pendingDeviceRunRequests) {
          const candidate = devices.find((d) => d.id === rr.device_id) ?? null;
          if (!candidate) continue;
          const s = deviceSchedule.get(candidate.id);
          if (!s) continue;

          const skipCircuit = shouldSkip(`d:${candidate.id}`, nowMs);
          const skipBackoff = !!s.nextAllowedAtMs && nowMs < s.nextAllowedAtMs;
          if (skipCircuit || skipBackoff) continue;

          selectedDevice = candidate;
          selectedRequestId = rr.id;
          break;
        }

        // Fallback: automatic round-robin.
        if (!selectedDevice) {
          const pickedId = deviceOrder[deviceCursor % deviceOrder.length];
          deviceCursor = (deviceCursor + 1) % deviceOrder.length;
          selectedDevice = devices.find((d) => d.id === pickedId) ?? null;
        }

        const device = selectedDevice;
        if (!device) {
          await sleep(1000);
          continue;
        }

        const state = deviceSchedule.get(device.id)!;
        const overrides = getDeviceOverrides(device.site, deviceDefaults, device);

        // Respect circuit-breaker and per-device backoff windows.
        const skipCircuit = shouldSkip(`d:${device.id}`, nowMs);
        const skipBackoff = !!state.nextAllowedAtMs && nowMs < state.nextAllowedAtMs;
        const minIntervalMs = overrides.stepSeconds * 1000;
        const skipInterval = !selectedRequestId && state.lastRunAtMs && nowMs - state.lastRunAtMs < minIntervalMs;
        if (skipCircuit || skipBackoff) {
          log("device_skipped", {
            device_id: device.id,
            site: device.site,
            reason: skipBackoff ? "backoff" : "circuit",
          });

          // If this was a manual request, consume it so it doesn't sit in the queue.
          if (selectedRequestId) {
            await sendReport({ device_run_requests_consumed: [{ id: selectedRequestId }] });
            pendingDeviceRunRequests = pendingDeviceRunRequests.filter((rr) => rr.id !== selectedRequestId);
          }

          await sleep(1000);
          continue;
        }
        if (skipInterval) {
          log("device_skipped", {
            device_id: device.id,
            site: device.site,
            reason: "per_device_interval",
          });
          await sleep(1000);
          continue;
        }

        await sleep(jitterMs(3000));

        const deviceReports: AgentDeviceMetricReport[] = [];
        const backoffUpdates: AgentDeviceBackoffReport[] = [];
        const consumedRunRequests: AgentDeviceRunRequestConsumedReport[] = [];

        const key = `d:${device.id}`;
        try {
          // Single endpoint per run (iface only) for maximum stability:
          // We only care about WAN/LAN link status (up/down).
          const ifaceCooldownActive = state.ifaceNextAllowedAtMs && nowMs < state.ifaceNextAllowedAtMs;
          const ifaceDue =
            !ifaceCooldownActive && nowMs - state.lastIfaceAtMs >= overrides.interfaceIntervalSeconds * 1000;
          const mode: "perf" | "iface" | "status" = ifaceDue ? "iface" : "iface";

          const r = await runDeviceCheck(device, deviceTimeoutMs, { mode });
          recordResult(key, r.status !== "DOWN", nowMs);

          const is429 =
            r.status === "DEGRADED" &&
            typeof r.error === "string" &&
            r.error.startsWith("rate limited by FortiGate (429)");
          const rateLimitedEndpoint = r.error?.includes("endpoint=iface")
            ? "iface"
            : r.error?.includes("endpoint=status")
              ? "status"
              : r.error?.includes("endpoint=perf")
                ? "perf"
                : null;

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

            if (rateLimitedEndpoint === "iface") {
              const nextIfaceAllowedAtMs = nowMs + overrides.ifaceCooldownSeconds * 1000;
              state.ifaceNextAllowedAtMs = nextIfaceAllowedAtMs;
              state.lastError = r.error ?? null;
              backoffUpdates.push({
                device_id: device.id,
                backoff_seconds: state.backoffSeconds,
                next_allowed_at: state.nextAllowedAtMs ? new Date(state.nextAllowedAtMs).toISOString() : null,
                iface_next_allowed_at: new Date(nextIfaceAllowedAtMs).toISOString(),
                last_error: r.error ?? null,
                rate_limit_count: state.rateLimitCount,
                reason: "429 rate limit (iface cooldown)",
              });
              log("iface_backoff", {
                device_id: device.id,
                site: device.site,
                cooldown_seconds: overrides.ifaceCooldownSeconds,
              });
            } else {
              const nextCount = Math.max(1, state.rateLimitCount + 1);
              const nextBackoff = Math.min(600 * 2 ** (nextCount - 1), overrides.backoffCapSeconds);
              const nextAllowedAtMs = nowMs + nextBackoff * 1000;
              state.rateLimitCount = nextCount;
              state.backoffSeconds = nextBackoff;
              state.nextAllowedAtMs = nextAllowedAtMs;
              state.reason = "429";
              state.lastError = r.error ?? null;
              state.nextRunAtMs = nextAllowedAtMs + jitterMs(3000);
              backoffUpdates.push({
                device_id: device.id,
                backoff_seconds: nextBackoff,
                next_allowed_at: new Date(nextAllowedAtMs).toISOString(),
                iface_next_allowed_at: state.ifaceNextAllowedAtMs
                  ? new Date(state.ifaceNextAllowedAtMs).toISOString()
                  : null,
                last_error: r.error ?? null,
                rate_limit_count: state.rateLimitCount,
                reason: `429 rate limit (endpoint=${rateLimitedEndpoint ?? "unknown"})`,
              });
              log("device_backoff", { device_id: device.id, site: device.site, backoff_seconds: nextBackoff });
            }
          } else {
            // When we intentionally skip interface calls, keep the last known WAN/LAN values
            // so WAN1/WAN2 don't "disappear" from the dashboard.
            const effective: AgentDeviceMetricReport = {
              ...r,
              wan1_status: r.wan1_status ?? state.lastGood?.wan1_status ?? null,
              wan2_status: r.wan2_status ?? state.lastGood?.wan2_status ?? null,
              lan_status: r.lan_status ?? state.lastGood?.lan_status ?? null,
              wan1_ip: r.wan1_ip ?? state.lastGood?.wan1_ip ?? null,
              wan2_ip: r.wan2_ip ?? state.lastGood?.wan2_ip ?? null,
              lan_ip: r.lan_ip ?? state.lastGood?.lan_ip ?? null,
              sessions: r.sessions ?? state.lastGood?.sessions ?? null,
            };
            deviceReports.push(effective);

            // Only advance timestamps for the endpoint we actually called (and got data).
            if (mode === "status" && (r.uptime_seconds ?? null) !== null) state.lastStatusAtMs = nowMs;
            if (
              mode === "iface" &&
              ((effective.wan1_status ?? null) !== null ||
                (effective.wan2_status ?? null) !== null ||
                (effective.lan_status ?? null) !== null)
            ) {
              state.lastIfaceAtMs = nowMs;
            }
            if (mode === "perf" && ((effective.cpu_percent ?? null) !== null || (effective.mem_percent ?? null) !== null)) {
              state.lastPerfAtMs = nowMs;
            }

            if (effective.status !== "DOWN") {
              state.lastGood = {
                uptime_seconds: effective.uptime_seconds ?? null,
                cpu_percent: effective.cpu_percent ?? null,
                mem_percent: effective.mem_percent ?? null,
                sessions: effective.sessions ?? null,
                wan1_status: effective.wan1_status ?? null,
                wan2_status: effective.wan2_status ?? null,
                lan_status: effective.lan_status ?? null,
                wan1_ip: effective.wan1_ip ?? null,
                wan2_ip: effective.wan2_ip ?? null,
                lan_ip: effective.lan_ip ?? null,
              };
            }

            if (effective.status === "DEGRADED" && effective.error && state.lastError !== effective.error) {
              state.lastError = effective.error;
              backoffUpdates.push({
                device_id: device.id,
                backoff_seconds: state.backoffSeconds,
                next_allowed_at: state.nextAllowedAtMs ? new Date(state.nextAllowedAtMs).toISOString() : null,
                iface_next_allowed_at: state.ifaceNextAllowedAtMs
                  ? new Date(state.ifaceNextAllowedAtMs).toISOString()
                  : null,
                last_error: effective.error,
                rate_limit_count: state.rateLimitCount,
                reason: effective.error,
              });
            }

            if (state.backoffSeconds || state.nextAllowedAtMs) {
              state.backoffSeconds = 0;
              state.nextAllowedAtMs = 0;
              state.reason = null;
              state.rateLimitCount = 0;
              state.lastError = null;
              backoffUpdates.push({
                device_id: device.id,
                backoff_seconds: 0,
                next_allowed_at: null,
                iface_next_allowed_at: state.ifaceNextAllowedAtMs
                  ? new Date(state.ifaceNextAllowedAtMs).toISOString()
                  : null,
                last_error: null,
                rate_limit_count: 0,
                reason: null,
              });
            }
            state.nextRunAtMs =
              nowMs + deviceStepSeconds * 1000 * Math.max(1, deviceOrder.length) + jitterMs(3000);
          }
          state.lastRunAtMs = nowMs;
        } catch (e) {
          recordResult(key, false, nowMs);
          const raw = e instanceof Error ? e.message : String(e);
          const normalized = raw.toLowerCase();
          const isConfigError =
            normalized.includes("missing api token") ||
            normalized.includes("api_token_secret_ref") ||
            normalized.includes("missing api_base_url") ||
            normalized.includes("missing lan_ip");
          const isFetchError =
            normalized.includes("fetch failed") ||
            normalized.includes("timeout") ||
            normalized.includes("connecttimeout");
          deviceReports.push({
            device_id: device.id,
            checked_at: new Date().toISOString(),
            reachable: false,
            status: isConfigError || isFetchError ? "DEGRADED" : "DOWN",
            error: raw,
          });
          state.lastError = raw;
          backoffUpdates.push({
            device_id: device.id,
            backoff_seconds: state.backoffSeconds,
            next_allowed_at: state.nextAllowedAtMs ? new Date(state.nextAllowedAtMs).toISOString() : null,
            iface_next_allowed_at: state.ifaceNextAllowedAtMs
              ? new Date(state.ifaceNextAllowedAtMs).toISOString()
              : null,
            last_error: raw,
            rate_limit_count: state.rateLimitCount,
            reason: raw,
          });
          state.nextRunAtMs =
            nowMs + deviceStepSeconds * 1000 * Math.max(1, deviceOrder.length) + jitterMs(3000);
          state.lastRunAtMs = nowMs;
        } finally {
          // Consume manual requests even on failure/rate-limit so the button doesn't "stick".
          if (selectedRequestId) {
            consumedRunRequests.push({ id: selectedRequestId });
            pendingDeviceRunRequests = pendingDeviceRunRequests.filter((rr) => rr.id !== selectedRequestId);
          }
        }

        deviceSchedule.set(device.id, state);
        await sendReport({
          device_metrics: deviceReports,
          device_backoff: backoffUpdates,
          device_run_requests_consumed: consumedRunRequests,
        });
      }
    }

    await sleep(1000);
  }
}

main().catch((e) => {
  log("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
