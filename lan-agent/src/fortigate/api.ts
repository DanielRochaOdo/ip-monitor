import { fetchJson } from "../util.js";

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
  const cpu = pickNumber(results?.cpu) ?? (Array.isArray(results?.cpu) ? pickNumber(results.cpu[0]) : null);
  const mem = pickNumber(results?.mem) ?? pickNumber(results?.memory) ?? null;
  const sessions = pickNumber(results?.sessions) ?? pickNumber(results?.session_count) ?? null;
  return { cpu, mem, sessions };
}

function normalizeInterfaceStatus(value: unknown): string | null {
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
  const ifaces: any[] = Array.isArray(list) ? list : Array.isArray(list?.interfaces) ? list.interfaces : [];

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

    if (name === "wan1") {
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

  return { wan1Status, wan1Ip, wan2Status, wan2Ip, lanStatus, lanIp };
}

export async function collectFortiGateApiMetrics(
  device: FortiGateDeviceTask,
  opts: { timeoutMs?: number; tokenMode?: "query" | "header" } = {},
): Promise<FortiGateMetrics> {
  const token = getTokenForDevice(device);
  if (!token) {
    return {
      reachable: false,
      status: "DOWN",
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
      error: "missing api token (api_token_secret_ref)",
    };
  }

  const base =
    device.api_base_url?.trim() ||
    (device.lan_ip ? `https://${device.lan_ip}:${device.mgmt_port}` : null);
  if (!base) {
    return {
      reachable: false,
      status: "DOWN",
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

  const headers: Record<string, string> = {};
  if (tokenMode === "header") {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const statusUrl = withAccessToken(`${base}/api/v2/monitor/system/status`, token, tokenMode);
  const perfUrl = withAccessToken(`${base}/api/v2/monitor/system/performance/status`, token, tokenMode);
  const ifaceUrl = withAccessToken(`${base}/api/v2/monitor/system/interface`, token, tokenMode);

  const statusRes = await fetchJson<any>(statusUrl, { headers, timeoutMs });
  if (!statusRes.ok || !statusRes.data) {
    return {
      reachable: false,
      status: "DOWN",
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
      error: statusRes.text ?? `api status failed (${statusRes.status})`,
    };
  }

  const hostname = extractHostname(statusRes.data) ?? device.hostname ?? null;
  const firmwareVersion = extractFirmware(statusRes.data);
  const uptimeSeconds = extractUptimeSeconds(statusRes.data);

  const perfRes = await fetchJson<any>(perfUrl, { headers, timeoutMs });
  const ifaceRes = await fetchJson<any>(ifaceUrl, { headers, timeoutMs });

  const perf = perfRes.ok && perfRes.data ? extractPerf(perfRes.data) : { cpu: null, mem: null, sessions: null };
  const iface =
    ifaceRes.ok && ifaceRes.data
      ? extractInterfaces(ifaceRes.data, device.wan_public_ips ?? [])
      : { wan1Status: null, wan1Ip: null, wan2Status: null, wan2Ip: null, lanStatus: null, lanIp: null };

  const degraded = !perfRes.ok || !ifaceRes.ok;

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
    error: degraded ? `partial api: perf=${perfRes.status} iface=${ifaceRes.status}` : null,
  };
}

