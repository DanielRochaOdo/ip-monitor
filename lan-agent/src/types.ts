export type AgentPullResponse = {
  agent: {
    id: string;
    user_id: string;
    name: string;
    site: string;
  };
  now: string;
  monitors: Array<{
    id: string;
    user_id: string;
    ip_address: string;
    nickname: string;
    check_type: "TCP" | "HTTP" | "ICMP";
    ports: number[] | null;
    port: number | null;
    http_url: string | null;
    http_method: "GET" | "HEAD" | null;
    http_expected_status: number | null;
    ping_interval_seconds: number;
    failure_threshold: number;
    success_threshold: number | null;
    next_check_at: string;
    is_active: boolean;
    is_private: boolean;
  }>;
  devices: Array<{
    id: string;
    user_id: string;
    site: string;
    hostname: string | null;
    vendor: string;
    model: string | null;
    firmware_expected: string | null;
    wan_public_ips: string[];
    lan_ip: string | null;
    agent_id: string | null;
    mgmt_method: "API" | "SNMP" | "TCP_ONLY";
    mgmt_port: number;
    api_base_url: string | null;
    api_token_secret_ref: string | null;
    snmp_version: "v2c" | "v3" | null;
    snmp_target: string | null;
    snmp_community: string | null;
  }>;
};

export type AgentMonitorReport = {
  id: string;
  checked_at?: string;
  status: "UP" | "DOWN" | "DEGRADED";
  latency_ms?: number | null;
  error_message?: string | null;
  check_method: "ICMP" | "TCP" | "HTTP";
};

export type AgentDeviceMetricReport = {
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

