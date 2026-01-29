import { fetchJson, log } from "../util.js";

export type FortiGateDeviceTask = {
  id: string;
  site: string;
  hostname: string | null;
  wan_public_ips: string[];
  lan_ip: string | null;
  mgmt_port: number;
  api_base_url: string | null;
  api_token_secret_ref: string | null;
};

export type FortiGateMetrics = {
  reachable: boolean;
  status: "UP" | "DOWN" | "DEGRADED";
  hostname: string | null;
  firmwareVersion: string | null;
  uptimeSeconds: number | null;
  cpuPercent: number | null;
  memPercent: number | null;
  sessions: number | null;
  wan1Status: string | null;
  wan1Ip: string | null;
  wan2Status: string | null;
  wan2Ip: string | null;
  lanStatus: string | null;
  lanIp: string | null;
  error: string | null;
  rateLimited?: boolean;
};

function withAccessToken(url: string, token: string, mode: "query" | "header") {
  if (mode === "header") return url;
  const u = new URL(url);
  if (!u.searchParams.get("access_token")) {
    u.searchParams.set("access_token", token);
  }
  return u.toString();
}

function getTokenForDevice(device: FortiGateDeviceTask) {
  const ref = device.api_token_secret_ref?.trim();
  if (!ref) return null;
  return process.env[ref]?.trim() ?? null;
}

function pickNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractHostname(statusJson: any): string | null {
  return (
    statusJson?.results?.hostname ??
    statusJson?.results?.host_name ??
    statusJson?.results?.name ??
    null
  );
}

function extractFirmware(statusJson: any): string | null {
  return statusJson?.results?.version ?? statusJson?.results?.firmware_version ?? null;
}

function extractUptimeSeconds(statusJson: any): number | null {
  const v = statusJson?.results?.uptime ?? statusJson?.results?.uptime_sec ?? statusJson?.results?.uptime_seconds;
  return pickNumber(v);
}

function extractPerf(perfJson: any): { cpu: number | null; mem: number | null; sessions: number | null } {
  const results = perfJson?.results ?? {};

  // FortiOS 7.2 returns:
  // results.cpu: { user, system, idle, ... }
  // results.mem: { total, used, ... } (bytes)
  const cpuIdle = pickNumber(results?.cpu?.idle);
  const cpu = cpuIdle !== null ? Math.max(0, Math.min(100, Math.round(100 - cpuIdle))) : null;

  const memTotal = pickNumber(results?.mem?.total);
  const memUsed = pickNumber(results?.mem?.used);
  const mem =
    memTotal !== null && memUsed !== null && memTotal > 0
      ? Math.max(0, Math.min(100, Math.round((memUsed / memTotal) * 100)))
      : null;

  // Some FortiOS builds expose sessions in other monitor endpoints; keep optional.
  const sessions = pickNumber(results?.sessions) ?? pickNumber(results?.session_count) ?? null;
  return { cpu, mem, sessions };
}

function normalizeInterfaceStatus(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "up" : "down";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function extractInterfaces(
  ifaceJson: any,
  wanPublicIps: string[],
): {
  wan1Status: string | null;
  wan1Ip: string | null;
  wan2Status: string | null;
  wan2Ip: string | null;
  lanStatus: string | null;
  lanIp: string | null;
} {
  const list = (ifaceJson?.results ?? ifaceJson?.result ?? ifaceJson) as any;
  // FortiOS 7.2 returns "results" as an object keyed by interface name.
  const ifaces: any[] = Array.isArray(list)
    ? list
    : list && typeof list === "object"
      ? Object.values(list)
      : Array.isArray(list?.interfaces)
        ? list.interfaces
        : [];

  let wan1Status: string | null = null;
  let wan1Ip: string | null = null;
  let wan2Status: string | null = null;
  let wan2Ip: string | null = null;
  let lanStatus: string | null = null;
  let lanIp: string | null = null;

  const wanIpSet = new Set(wanPublicIps.filter(Boolean));

  for (const iface of ifaces) {
    const name = String(iface?.name ?? iface?.interface ?? "").toLowerCase();
    const ip = iface?.ip ?? iface?.ip_address ?? iface?.ipv4_address ?? null;
    const status = normalizeInterfaceStatus(iface?.link ?? iface?.status ?? iface?.state ?? null);
    const ipStr = typeof ip === "string" ? ip.split(" ")[0] : null;

    // FortiOS may use "wan" (not "wan1").
    if (name === "wan" || name === "wan1") {
      wan1Status = status;
      wan1Ip = ipStr;
    } else if (name === "wan2") {
      wan2Status = status;
      wan2Ip = ipStr;
    } else if (name.startsWith("lan")) {
      lanStatus = status;
      lanIp = ipStr;
    }

    // If FortiGate uses PPPoE interface names, bind by IP match.
    if (ipStr && wanIpSet.has(ipStr)) {
      if (!wan1Ip) {
        wan1Ip = ipStr;
        wan1Status = status;
      } else if (!wan2Ip && wan1Ip !== ipStr) {
        wan2Ip = ipStr;
        wan2Status = status;
      }
    }
  }

  // Heuristic fallback for PPPoE-like interfaces (often short names like "a") when we couldn't match by name/IP.
  if (!wan2Ip) {
    const candidates = ifaces
      .map((iface) => {
        const name = String(iface?.name ?? iface?.interface ?? "").toLowerCase();
        const ip = iface?.ip ?? iface?.ip_address ?? iface?.ipv4_address ?? null;
        const ipStr = typeof ip === "string" ? ip.split(" ")[0] : null;
        const status = normalizeInterfaceStatus(iface?.link ?? iface?.status ?? iface?.state ?? null);
        const mask = pickNumber(iface?.mask);
        const isLan = name.startsWith("lan");
        const isCandidate =
          !!ipStr &&
          ipStr !== "0.0.0.0" &&
          !isLan &&
          (name.startsWith("wan") || mask === 32 || name.length <= 2);
        return isCandidate ? { ip: ipStr, status } : null;
      })
      .filter((item): item is { ip: string; status: string | null } => !!item);

    for (const candidate of candidates) {
      if (candidate.ip !== wan1Ip) {
        wan2Ip = candidate.ip;
        wan2Status = candidate.status;
        break;
      }
    }
  }

  return { wan1Status, wan1Ip, wan2Status, wan2Ip, lanStatus, lanIp };
}

export async function collectFortiGateApiMetrics(
  device: FortiGateDeviceTask,
  opts: {
    timeoutMs?: number;
    tokenMode?: "query" | "header";
    mode?: "perf" | "iface" | "status";
  } = {},
): Promise<FortiGateMetrics> {
  const ref = device.api_token_secret_ref?.trim() ?? null;
  const token = getTokenForDevice(device);
  if (!token) {
    log("fgt_token_missing", {
      device_id: device.id,
      site: device.site,
      api_token_secret_ref: ref ?? null,
    });
    return {
      reachable: false,
      status: "DEGRADED",
      hostname: device.hostname,
      firmwareVersion: null,
      uptimeSeconds: null,
      cpuPercent: null,
      memPercent: null,
      sessions: null,
      wan1Status: null,
      wan1Ip: null,
      wan2Status: null,
      wan2Ip: null,
      lanStatus: null,
      lanIp: null,
      error: `missing api token (${ref ?? "api_token_secret_ref"})`,
    };
  }

  const base =
    device.api_base_url?.trim() ||
    (device.lan_ip ? `https://${device.lan_ip}:${device.mgmt_port}` : null);
  if (!base) {
    return {
      reachable: false,
      status: "DEGRADED",
      hostname: device.hostname,
      firmwareVersion: null,
      uptimeSeconds: null,
      cpuPercent: null,
      memPercent: null,
      sessions: null,
      wan1Status: null,
      wan1Ip: null,
      wan2Status: null,
      wan2Ip: null,
      lanStatus: null,
      lanIp: null,
      error: "missing api_base_url/lan_ip",
    };
  }

  const timeoutMs = opts.timeoutMs ?? 2500;
  const tokenMode = opts.tokenMode ?? ((process.env.FORTIGATE_TOKEN_MODE as "query" | "header" | undefined) ?? "query");
  const mode = opts.mode ?? "perf";

  const headers: Record<string, string> = {};
  if (tokenMode === "header") {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const perfUrl = withAccessToken(`${base}/api/v2/monitor/system/performance/status`, token, tokenMode);
  const ifaceUrl = withAccessToken(`${base}/api/v2/monitor/system/interface`, token, tokenMode);
  const statusUrl = withAccessToken(`${base}/api/v2/monitor/system/status`, token, tokenMode);

  // IMPORTANT: to avoid FortiGate 429 bursts, we intentionally call ONLY ONE endpoint per run.
  // The scheduler decides which mode to run (perf/iface/status) and we rely on lastGood caching
  // to keep the dashboard useful in-between refreshes.
  const statusRes = mode === "status" ? await fetchJson<any>(statusUrl, { headers, timeoutMs }) : null;
  const perfRes = mode === "perf" ? await fetchJson<any>(perfUrl, { headers, timeoutMs }) : null;
  const ifaceRes = mode === "iface" ? await fetchJson<any>(ifaceUrl, { headers, timeoutMs }) : null;

  const hostname =
    statusRes?.ok && statusRes.data ? extractHostname(statusRes.data) ?? device.hostname ?? null : device.hostname ?? null;
  const firmwareVersion = statusRes?.ok && statusRes.data ? extractFirmware(statusRes.data) : null;
  const uptimeSeconds = statusRes?.ok && statusRes.data ? extractUptimeSeconds(statusRes.data) : null;

  // Basic observability: log non-2xx responses per endpoint with latency.
  const truncate = (value: unknown) => {
    const s = typeof value === "string" ? value : value == null ? "" : String(value);
    return s.length > 220 ? `${s.slice(0, 220)}...` : s;
  };

  const maybeLog = (endpoint: string, r: { ok: boolean; status: number; text: string | null; duration_ms: number }) => {
    if (r.ok) return;
    log("fgt_http", {
      device_id: device.id,
      site: device.site,
      endpoint,
      status: r.status,
      duration_ms: r.duration_ms,
      text: truncate(r.text),
    });
  };

  if (statusRes) maybeLog("status", statusRes);
  if (perfRes) maybeLog("perf", perfRes);
  if (ifaceRes) maybeLog("iface", ifaceRes);

  // Rate-limit: treat as reachable but degraded.
  if (statusRes?.status === 429 || perfRes?.status === 429 || ifaceRes?.status === 429) {
    return {
      reachable: true,
      status: "DEGRADED",
      hostname,
      firmwareVersion,
      uptimeSeconds,
      cpuPercent: null,
      memPercent: null,
      sessions: null,
      wan1Status: null,
      wan1Ip: null,
      wan2Status: null,
      wan2Ip: null,
      lanStatus: null,
      lanIp: null,
      rateLimited: true,
      error: "rate limited by FortiGate (429) - reduce AGENT_DEVICE_CONCURRENCY or increase interval",
    };
  }

  // Unauthorized/forbidden: reachable but misconfigured.
  const anyAuthError =
    (statusRes && (statusRes.status === 401 || statusRes.status === 403)) ||
    (perfRes && (perfRes.status === 401 || perfRes.status === 403)) ||
    (ifaceRes && (ifaceRes.status === 401 || ifaceRes.status === 403));

  if (anyAuthError) {
    return {
      reachable: true,
      status: "DEGRADED",
      hostname,
      firmwareVersion,
      uptimeSeconds,
      cpuPercent: null,
      memPercent: null,
      sessions: null,
      wan1Status: null,
      wan1Ip: null,
      wan2Status: null,
      wan2Ip: null,
      lanStatus: null,
      lanIp: null,
      error: "unauthorized (401/403) - check token permissions/trusted hosts",
    };
  }

  const perf =
    perfRes && perfRes.ok && perfRes.data ? extractPerf(perfRes.data) : { cpu: null, mem: null, sessions: null };
  const iface =
    ifaceRes && ifaceRes.ok && ifaceRes.data
      ? extractInterfaces(ifaceRes.data, device.wan_public_ips ?? [])
      : { wan1Status: null, wan1Ip: null, wan2Status: null, wan2Ip: null, lanStatus: null, lanIp: null };

  const anyOk = (perfRes?.ok ?? false) || (ifaceRes?.ok ?? false) || (statusRes?.ok ?? false);
  if (!anyOk) {
    const status =
      statusRes?.text ??
      perfRes?.text ??
      ifaceRes?.text ??
      `api failed (mode=${mode} status=${statusRes?.status ?? "-"} perf=${perfRes?.status ?? "-"} iface=${ifaceRes?.status ?? "-"})`;
    return {
      reachable: false,
      status: "DEGRADED",
      hostname,
      firmwareVersion,
      uptimeSeconds,
      cpuPercent: null,
      memPercent: null,
      sessions: null,
      wan1Status: null,
      wan1Ip: null,
      wan2Status: null,
      wan2Ip: null,
      lanStatus: null,
      lanIp: null,
      error: status,
    };
  }

  // With "single endpoint per run", consider it degraded only if the chosen endpoint failed.
  const degraded = mode === "perf" ? !(perfRes?.ok ?? false) : mode === "iface" ? !(ifaceRes?.ok ?? false) : !(statusRes?.ok ?? false);

  return {
    reachable: true,
    status: degraded ? "DEGRADED" : "UP",
    hostname,
    firmwareVersion,
    uptimeSeconds,
    cpuPercent: perf.cpu,
    memPercent: perf.mem,
      sessions: perf.sessions,
      wan1Status: iface.wan1Status,
      wan1Ip: iface.wan1Ip,
      wan2Status: iface.wan2Status,
    wan2Ip: iface.wan2Ip,
    lanStatus: iface.lanStatus,
    lanIp: iface.lanIp,
    error: degraded ? `partial api: mode=${mode}` : null,
  };
}
