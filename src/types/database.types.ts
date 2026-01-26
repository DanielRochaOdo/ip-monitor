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
      monitors: {
        Row: {
          id: string;
          user_id: string;
          ip_address: string;
          nickname: string;
          ping_interval_seconds: number;
          failure_threshold: number;
          check_type: "TCP";
          ports: number[];
          is_active: boolean;
          last_status: "UP" | "DOWN" | null;
          last_checked_at: string | null;
          next_check_at: string;
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
          check_type?: "TCP";
          ports?: number[];
          is_active?: boolean;
          last_status?: "UP" | "DOWN" | null;
          last_checked_at?: string | null;
          next_check_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          ip_address?: string;
          nickname?: string;
          ping_interval_seconds?: number;
          failure_threshold?: number;
          check_type?: "TCP";
          ports?: number[];
          is_active?: boolean;
          last_status?: "UP" | "DOWN" | null;
          last_checked_at?: string | null;
          next_check_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      monitor_checks: {
        Row: {
          id: string;
          monitor_id: string;
          checked_at: string;
          status: "UP" | "DOWN";
          latency_ms: number | null;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          monitor_id: string;
          checked_at?: string;
          status: "UP" | "DOWN";
          latency_ms?: number | null;
          error_message?: string | null;
        };
        Update: {
          checked_at?: string;
          status?: "UP" | "DOWN";
          latency_ms?: number | null;
          error_message?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "monitor_checks_monitor_id_fkey";
            columns: ["monitor_id"];
            isOneToOne?: boolean;
            referencedRelation: "monitors";
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
