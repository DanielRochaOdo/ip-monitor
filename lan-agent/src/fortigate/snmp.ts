import snmp from "net-snmp";

export type FortiGateSnmpTask = {
  lan_ip: string | null;
  snmp_target: string | null;
  snmp_community: string | null;
};

export type FortiGateSnmpMetrics = {
  reachable: boolean;
  status: "UP" | "DOWN" | "DEGRADED";
  uptimeSeconds: number | null;
  cpuPercent: number | null;
  memPercent: number | null;
  error: string | null;
};

const OID_SYS_UPTIME = "1.3.6.1.2.1.1.3.0";
const OID_FG_CPU = "1.3.6.1.4.1.12356.101.4.1.3.0";
const OID_FG_MEM = "1.3.6.1.4.1.12356.101.4.1.4.0";

function resolveCommunity(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("env:")) {
    const key = trimmed.slice(4).trim();
    return process.env[key]?.trim() ?? null;
  }
  return trimmed;
}

export async function collectFortiGateSnmpMetrics(
  task: FortiGateSnmpTask,
  opts: { timeoutMs?: number } = {},
): Promise<FortiGateSnmpMetrics> {
  const target = task.snmp_target?.trim() || task.lan_ip?.trim();
  const community = resolveCommunity(task.snmp_community);
  if (!target || !community) {
    return {
      reachable: false,
      status: "DOWN",
      uptimeSeconds: null,
      cpuPercent: null,
      memPercent: null,
      error: "missing snmp_target/lan_ip or snmp_community",
    };
  }

  const timeoutMs = opts.timeoutMs ?? 2500;
  const session = snmp.createSession(target, community, {
    version: snmp.Version2c,
    timeout: timeoutMs,
    retries: 0,
  });

  return new Promise<FortiGateSnmpMetrics>((resolve) => {
    session.get([OID_SYS_UPTIME, OID_FG_CPU, OID_FG_MEM], (error: unknown, varbinds: any[]) => {
      session.close();

      if (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolve({
          reachable: false,
          status: "DOWN",
          uptimeSeconds: null,
          cpuPercent: null,
          memPercent: null,
          error: message,
        });
        return;
      }

      const map = new Map<string, any>();
      for (const vb of varbinds ?? []) {
        if (vb?.oid) map.set(vb.oid, vb.value);
      }

      const uptimeTicks = map.get(OID_SYS_UPTIME);
      const uptimeSeconds =
        typeof uptimeTicks === "number" && Number.isFinite(uptimeTicks)
          ? Math.floor(uptimeTicks / 100)
          : null;
      const cpuPercent =
        typeof map.get(OID_FG_CPU) === "number" ? (map.get(OID_FG_CPU) as number) : null;
      const memPercent =
        typeof map.get(OID_FG_MEM) === "number" ? (map.get(OID_FG_MEM) as number) : null;

      resolve({
        reachable: true,
        status: "UP",
        uptimeSeconds,
        cpuPercent,
        memPercent,
        error: null,
      });
    });
  });
}
