export type MonitorCheckSummary = {
  checkedAt: string;
  status: "UP" | "DOWN" | "DEGRADED";
  latencyMs: number | null;
  errorMessage: string | null;
};

type BaseEmailProps = {
  nickname: string;
  ip: string;
  dashboardUrl: string;
  checks: MonitorCheckSummary[];
  occurredAt: string;
};

const renderChecksTable = (checks: MonitorCheckSummary) => {
  return `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;">${new Date(checks.checkedAt).toLocaleString()}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;">${checks.status}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;">${checks.latencyMs ? `${checks.latencyMs}ms` : "--"}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;">${checks.errorMessage ?? "OK"}</td>
    </tr>
  `;
};

const renderChecks = (checks: MonitorCheckSummary[]) => {
  if (!checks.length) {
    return "<tr><td colspan='4' style='padding:12px;'>No checks recorded yet.</td></tr>";
  }

  return checks.map(renderChecksTable).join("");
};

function buildEmailBody(props: BaseEmailProps & { level: "down" | "up"; status: "DOWN" | "UP"; summary: string }) {
  const accentColor = props.level === "down" ? "#ef4444" : "#22c55e";
  return `
    <div style="font-family: system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#0f172a;">
      <div style="border-left:4px solid ${accentColor}; padding:12px 16px; margin-bottom:16px;">
        <p style="margin:0;font-size:14px;color:#475569;">${props.summary}</p>
        <p style="margin:4px 0 0;font-size:20px;font-weight:600;">${props.nickname} (${props.ip})</p>
      </div>
      <p style="margin:0 0 8px;font-size:14px;">Event time: <strong>${new Date(props.occurredAt).toLocaleString()}</strong></p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <thead>
          <tr>
            <th style="padding:6px 12px;text-align:left;border-bottom:2px solid #cbd5f5;">Check Time</th>
            <th style="padding:6px 12px;text-align:left;border-bottom:2px solid #cbd5f5;">Status</th>
            <th style="padding:6px 12px;text-align:left;border-bottom:2px solid #cbd5f5;">Latency</th>
            <th style="padding:6px 12px;text-align:left;border-bottom:2px solid #cbd5f5;">Details</th>
          </tr>
        </thead>
        <tbody>
          ${renderChecks(props.checks)}
        </tbody>
      </table>
      <div style="margin-top:24px;padding:16px;border-radius:10px;background:#f8fafc;">
        <a href="${props.dashboardUrl}" style="text-decoration:none;font-weight:600;color:${accentColor};">View dashboard</a>
      </div>
    </div>
  `;
}

export function buildDownEmail(props: BaseEmailProps) {
  return {
    subject: `[Monitor] ${props.nickname} (${props.ip}) is DOWN`,
    html: buildEmailBody({
      ...props,
      level: "down",
      status: "DOWN",
      summary: "Monitor is unreachable after threshold of retries.",
    }),
  };
}

export function buildUpEmail(props: BaseEmailProps) {
  return {
    subject: `[Monitor] ${props.nickname} (${props.ip}) is UP again`,
    html: buildEmailBody({
      ...props,
      level: "up",
      status: "UP",
      summary: "Monitor has recovered and is reachable again.",
    }),
  };
}

