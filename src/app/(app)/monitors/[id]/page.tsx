/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MonitorDetail } from "@/components/monitor-detail";
import { useAuthReady, useSession } from "@/components/supabase-provider";
import { useToast } from "@/components/toast-provider";

type MonitorPayload = {
  id: string;
  nickname: string;
  ip_address: string;
  ping_interval_seconds: number;
  failure_threshold: number;
  ports: number[];
  is_active: boolean;
  last_status: "UP" | "DOWN" | null;
  last_checked_at: string | null;
};

type CheckPayload = {
  id: string;
  checked_at: string;
  status: "UP" | "DOWN";
  latency_ms: number | null;
  error_message: string | null;
};

type PageProps = {
  params: { id: string };
};

export default function MonitorDetailPage({ params }: PageProps) {
  const [monitor, setMonitor] = useState<MonitorPayload | null>(null);
  const [checks, setChecks] = useState<CheckPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const session = useSession();
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
    if (!session?.access_token) {
      router.replace("/login");
    }
  }, [authReady, router, session?.access_token]);

  useEffect(() => {
    if (!authReady || !session?.access_token) return;

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const [monitorRes, checksRes] = await Promise.all([
        fetch(`/api/monitors/${params.id}`, { headers: authHeaders, cache: "no-store" }),
        fetch(`/api/reports/checks?monitorId=${params.id}&limit=10`, {
          headers: authHeaders,
          cache: "no-store",
        }),
      ]);

      if (cancelled) return;

      if (!monitorRes.ok) {
        toast.push({ title: "Monitor não encontrado", variant: "error" });
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
  }, [authHeaders, authReady, params.id, router, session?.access_token, toast]);

  if (loading || !monitor) {
    return <div className="text-sm text-slate-400">Carregando...</div>;
  }

  return <MonitorDetail monitor={monitor} checks={checks} />;
}
