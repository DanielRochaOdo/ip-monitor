"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MonitorDetail } from "@/components/monitor-detail";
import { useAuthReady, useSession, useSupabaseClient } from "@/components/supabase-provider";
import { useToast } from "@/components/toast-provider";

type MonitorPayload = {
  id: string;
  nickname: string;
  ip_address: string;
  ping_interval_seconds: number;
  failure_threshold: number;
  success_threshold: number;
  check_type: "TCP" | "HTTP" | "ICMP";
  ports: number[];
  port: number | null;
  http_url: string | null;
  http_method: "GET" | "HEAD" | null;
  http_expected_status: number | null;
  agent_id: string | null;
  is_active: boolean;
  last_status: "UP" | "DOWN" | null;
  status: "UP" | "DOWN" | "DEGRADED" | null;
  last_checked_at: string | null;
  last_latency_ms: number | null;
  last_error: string | null;
};

type CheckPayload = {
  id: string;
  checked_at: string;
  status: "UP" | "DOWN" | "DEGRADED";
  latency_ms: number | null;
  error_message: string | null;
  source: "CLOUD" | "LAN";
  check_method: string | null;
};

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
};

export default function MonitorDetailPage({ params }: PageProps) {
  const [monitor, setMonitor] = useState<MonitorPayload | null>(null);
  const [checks, setChecks] = useState<CheckPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [monitorId, setMonitorId] = useState<string | null>(null);
  const session = useSession();
  const supabase = useSupabaseClient();
  const authReady = useAuthReady();
  const router = useRouter();
  const toast = useToast();

  const authHeaders = useMemo(() => {
    if (!session?.access_token) return {};
    return {
      Authorization: `Bearer ${session.access_token}`,
      ...(session.refresh_token ? { "x-refresh-token": session.refresh_token } : {}),
    };
  }, [session]);

  useEffect(() => {
    if (!authReady) return;
    if (session?.access_token) return;

    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session?.access_token) {
        router.replace("/login");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authReady, router, session?.access_token, supabase]);

  useEffect(() => {
    if (!authReady || !session?.access_token) return;

    let cancelled = false;
    Promise.resolve(params).then((resolved) => {
      if (cancelled) return;
      setMonitorId(resolved.id);
    });

    return () => {
      cancelled = true;
    };
  }, [authReady, params, session?.access_token]);

  useEffect(() => {
    if (!authReady || !session?.access_token) return;
    if (!monitorId) return;

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const [monitorRes, checksRes] = await Promise.all([
        fetch(`/api/monitors/${monitorId}`, { headers: authHeaders, cache: "no-store" }),
        fetch(`/api/reports/checks?monitorId=${monitorId}&limit=50`, {
          headers: authHeaders,
          cache: "no-store",
        }),
      ]);

      if (cancelled) return;

      if (!monitorRes.ok) {
        toast.push({ title: "Monitor nao encontrado", variant: "error" });
        router.replace("/monitors");
        return;
      }

      const monitorJson = (await monitorRes.json()) as MonitorPayload;
      const checksJson = (await checksRes.json()) as { checks?: CheckPayload[] } | null;

      setMonitor(monitorJson);
      setChecks(checksJson?.checks ?? []);
      setLoading(false);
    };

    void load().catch((error) => {
      if (cancelled) return;
      setLoading(false);
      toast.push({
        title: "Falha ao carregar monitor",
        description: error instanceof Error ? error.message : "Tente novamente",
        variant: "error",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [authHeaders, authReady, monitorId, router, session?.access_token, toast]);

  if (loading || !monitorId || !monitor) {
    return <div className="text-sm text-slate-400">Carregando...</div>;
  }

  return <MonitorDetail monitor={monitor} checks={checks} />;
}
