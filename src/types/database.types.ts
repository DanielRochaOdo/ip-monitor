export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export type Database = {
  public: {
    Tables: {
      agents: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          site: string;
          token_hash: string;
          is_active: boolean;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          site: string;
          token_hash: string;
          is_active?: boolean;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          site?: string;
          token_hash?: string;
          is_active?: boolean;
          last_seen_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      monitors: {
        Row: {
          id: string;
          user_id: string;
          ip_address: string;
          nickname: string;
          ping_interval_seconds: number;
          failure_threshold: number;
          check_type: "TCP" | "HTTP" | "ICMP";
          ports: number[];
          is_active: boolean;
          last_status: "UP" | "DOWN" | null;
          last_checked_at: string | null;
          next_check_at: string;
          agent_id: string | null;
          http_url: string | null;
          http_method: "GET" | "HEAD" | null;
          http_expected_status: number | null;
          port: number | null;
          last_latency_ms: number | null;
          last_error: string | null;
          failure_count: number;
          status: "UP" | "DOWN" | "DEGRADED" | null;
          success_threshold: number;
          success_count: number;
          is_private: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          ip_address: string;
          nickname: string;
          ping_interval_seconds?: number;
          failure_threshold?: number;
          check_type?: "TCP" | "HTTP" | "ICMP";
          ports?: number[];
          is_active?: boolean;
          last_status?: "UP" | "DOWN" | null;
          last_checked_at?: string | null;
          next_check_at?: string;
          agent_id?: string | null;
          http_url?: string | null;
          http_method?: "GET" | "HEAD" | null;
          http_expected_status?: number | null;
          port?: number | null;
          last_latency_ms?: number | null;
          last_error?: string | null;
          failure_count?: number;
          status?: "UP" | "DOWN" | "DEGRADED" | null;
          success_threshold?: number;
          success_count?: number;
          is_private?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          ip_address?: string;
          nickname?: string;
          ping_interval_seconds?: number;
          failure_threshold?: number;
          check_type?: "TCP" | "HTTP" | "ICMP";
          ports?: number[];
          is_active?: boolean;
          last_status?: "UP" | "DOWN" | null;
          last_checked_at?: string | null;
          next_check_at?: string;
          agent_id?: string | null;
          http_url?: string | null;
          http_method?: "GET" | "HEAD" | null;
          http_expected_status?: number | null;
          port?: number | null;
          last_latency_ms?: number | null;
          last_error?: string | null;
          failure_count?: number;
          status?: "UP" | "DOWN" | "DEGRADED" | null;
          success_threshold?: number;
          success_count?: number;
          is_private?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "monitors_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne?: boolean;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
        ];
      };
      monitor_checks: {
        Row: {
          id: string;
          monitor_id: string;
          checked_at: string;
          status: "UP" | "DOWN" | "DEGRADED";
          latency_ms: number | null;
          error_message: string | null;
          source: "CLOUD" | "LAN";
          agent_id: string | null;
          check_method: string | null;
        };
        Insert: {
          id?: string;
          monitor_id: string;
          checked_at?: string;
          status: "UP" | "DOWN" | "DEGRADED";
          latency_ms?: number | null;
          error_message?: string | null;
          source?: "CLOUD" | "LAN";
          agent_id?: string | null;
          check_method?: string | null;
        };
        Update: {
          checked_at?: string;
          status?: "UP" | "DOWN" | "DEGRADED";
          latency_ms?: number | null;
          error_message?: string | null;
          source?: "CLOUD" | "LAN";
          agent_id?: string | null;
          check_method?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "monitor_checks_monitor_id_fkey";
            columns: ["monitor_id"];
            isOneToOne?: boolean;
            referencedRelation: "monitors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "monitor_checks_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne?: boolean;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
        ];
      };
      network_devices: {
        Row: {
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          site: string;
          hostname?: string | null;
          vendor?: string;
          model?: string | null;
          firmware_expected?: string | null;
          wan_public_ips?: string[];
          lan_ip?: string | null;
          agent_id?: string | null;
          mgmt_method?: "API" | "SNMP" | "TCP_ONLY";
          mgmt_port?: number;
          api_base_url?: string | null;
          api_token_secret_ref?: string | null;
          snmp_version?: "v2c" | "v3" | null;
          snmp_target?: string | null;
          snmp_community?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          site?: string;
          hostname?: string | null;
          vendor?: string;
          model?: string | null;
          firmware_expected?: string | null;
          wan_public_ips?: string[];
          lan_ip?: string | null;
          agent_id?: string | null;
          mgmt_method?: "API" | "SNMP" | "TCP_ONLY";
          mgmt_port?: number;
          api_base_url?: string | null;
          api_token_secret_ref?: string | null;
          snmp_version?: "v2c" | "v3" | null;
          snmp_target?: string | null;
          snmp_community?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "network_devices_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne?: boolean;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
        ];
      };
      device_metrics: {
        Row: {
          id: string;
          device_id: string;
          agent_id: string | null;
          checked_at: string;
          reachable: boolean;
          status: "UP" | "DOWN" | "DEGRADED";
          uptime_seconds: number | null;
          cpu_percent: number | null;
          mem_percent: number | null;
          sessions: number | null;
          wan1_status: string | null;
          wan1_ip: string | null;
          wan2_status: string | null;
          wan2_ip: string | null;
          lan_status: string | null;
          lan_ip: string | null;
          rx_bps: number | null;
          tx_bps: number | null;
          error: string | null;
        };
        Insert: {
          id?: string;
          device_id: string;
          agent_id?: string | null;
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
        Update: {
          checked_at?: string;
          reachable?: boolean;
          status?: "UP" | "DOWN" | "DEGRADED";
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
        Relationships: [
          {
            foreignKeyName: "device_metrics_device_id_fkey";
            columns: ["device_id"];
            isOneToOne?: boolean;
            referencedRelation: "network_devices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "device_metrics_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne?: boolean;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
        ];
      };
        device_backoff: {
          Row: {
            device_id: string;
            agent_id: string | null;
            backoff_seconds: number;
            next_allowed_at: string | null;
            rate_limit_count: number;
            iface_next_allowed_at: string | null;
            last_error: string | null;
            reason: string | null;
            updated_at: string;
          };
          Insert: {
            device_id: string;
            agent_id?: string | null;
            backoff_seconds?: number;
            next_allowed_at?: string | null;
            rate_limit_count?: number;
            iface_next_allowed_at?: string | null;
            last_error?: string | null;
            reason?: string | null;
            updated_at?: string;
          };
          Update: {
            agent_id?: string | null;
            backoff_seconds?: number;
            next_allowed_at?: string | null;
            rate_limit_count?: number;
            iface_next_allowed_at?: string | null;
            last_error?: string | null;
            reason?: string | null;
            updated_at?: string;
          };
        Relationships: [
          {
            foreignKeyName: "device_backoff_device_id_fkey";
            columns: ["device_id"];
            isOneToOne?: boolean;
            referencedRelation: "network_devices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "device_backoff_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne?: boolean;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
        ];
      };
      device_run_requests: {
        Row: {
          id: string;
          device_id: string;
          requested_by: string;
          requested_at: string;
          consumed_at: string | null;
          consumed_by: string | null;
        };
        Insert: {
          id?: string;
          device_id: string;
          requested_by: string;
          requested_at?: string;
          consumed_at?: string | null;
          consumed_by?: string | null;
        };
        Update: {
          id?: string;
          device_id?: string;
          requested_by?: string;
          requested_at?: string;
          consumed_at?: string | null;
          consumed_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "device_run_requests_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "network_devices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "device_run_requests_consumed_by_fkey";
            columns: ["consumed_by"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
        ];
      };
      monitor_incidents: {
        Row: {
          id: string;
          monitor_id: string;
          started_at: string;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          monitor_id: string;
          started_at: string;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          resolved_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "monitor_incidents_monitor_id_fkey";
            columns: ["monitor_id"];
            isOneToOne?: boolean;
            referencedRelation: "monitors";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_settings: {
        Row: {
          id: string;
          user_id: string;
          alert_email: string;
          notify_on_down: boolean;
          notify_on_up: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          alert_email: string;
          notify_on_down?: boolean;
          notify_on_up?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          alert_email?: string;
          notify_on_down?: boolean;
          notify_on_up?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
