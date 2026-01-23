"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

import { runChecksAction } from "@/actions/runChecksAction";
import { useAuthReady, useSession } from "@/components/supabase-provider";
import { useToast } from "@/components/toast-provider";

type SummaryPayload = {
  totalMonitors: number;
  up: number;
  down: number;
  lastIncidents: {
    id: string;
    nickname: string | null;
    ip: string | null;
    monitorId: string;
    startedAt: string;
    resolvedAt: string | null;
  }[];
};

type MonitorPayload = {
  id: string;
  nickname: string;
  ip_address: string;
  ping_interval_seconds: number;
  last_status: "UP" | "DOWN" | null;
  last_checked_at: string | null;
};

type CheckPayload = {
  checked_at: string;
  status: "UP" | "DOWN";
};

export default function DashboardPage() {
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [monitors, setMonitors] = useState<MonitorPayload[]>([]);
  const [checks, setChecks] = useState<CheckPayload[]>([]);
  const session = useSession();
  const authReady = useAuthReady();
  const toast = useToast();
  const router = useRouter();
  const [isRunning, startTransition] = useTransition();
  const runningRef = useRef(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [lastRunSummary, setLastRunSummary] = useState<string | null>(null);

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

  const refresh = useCallback(async () => {
    if (!authReady || !session?.access_token) {
      return;
    }

    const [summaryRes, monitorsRes, checksRes] = await Promise.all([
      fetch("/api/reports/summary", { headers: authHeaders }),
      fetch("/api/monitors", { headers: authHeaders }),
      fetch("/api/reports/checks?limit=12", { headers: authHeaders }),
    ]);

    if (summaryRes.ok) {
      setSummary(await summaryRes.json());
    }

    if (monitorsRes.ok) {
      setMonitors((await monitorsRes.json()) ?? []);
    }

    if (checksRes.ok) {
      const data = await checksRes.json();
      setChecks(data.checks ?? []);
    }
  }, [authHeaders, authReady, session?.access_token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the UI in sync with background cron runs (polling).
  useEffect(() => {
    if (!authReady || !session?.access_token) return;
    const interval = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(interval);
  }, [authReady, refresh, session?.access_token]);

  const runNow = useCallback(
    async (showToast: boolean) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setLastRunSummary(null);

      try {
        const result = await runChecksAction();
        setLastRunAt(new Date().toLocaleString());
        const summaryText = `Verificados: ${result.checked} • Incidentes: +${result.incidentsCreated}/-${result.incidentsResolved} • Emails: ${result.notificationsSent}${result.errors?.length ? ` • Erros: ${result.errors.length}` : ""}`;
        setLastRunSummary(summaryText);

        if (showToast) {
          toast.push({
            title: "Verificações executadas",
            description: result.errors?.length ? `${summaryText}\n${result.errors[0]}` : summaryText,
            variant: result.errors?.length ? "error" : "success",
          });
        }

        // After running checks, refresh dashboard data.
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao executar verificações";
        setLastRunAt(new Date().toLocaleString());
        setLastRunSummary(message);
        if (showToast) {
          toast.push({ title: "Falha ao executar verificações", description: message, variant: "error" });
        }
      } finally {
        runningRef.current = false;
      }
    },
    [refresh, toast],
  );

  // In production, checks run via Vercel Cron (vercel.json).

  const chartData = useMemo(
    () =>
      checks.map((check) => ({
        name: new Date(check.checked_at).toLocaleTimeString(),
        up: check.status === "UP" ? 1 : 0,
        down: check.status === "DOWN" ? 1 : 0,
      })),
    [checks],
  );

  return (
    <>
    <div className="space-y-8">
      <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 shadow-inner">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Verificações</p>
            <p className="text-xs text-slate-300">
              {lastRunAt ? `Última execução: ${lastRunAt}` : "Agendado: a cada 60s (mínimo) via cron."}
            </p>
            {lastRunSummary ? <p className="text-xs text-slate-400">{lastRunSummary}</p> : null}
          </div>
          <button
            type="button"
            disabled={isRunning}
            aria-busy={isRunning}
            onClick={() =>
              startTransition(() => {
                void runNow(true);
              })
            }
            className={`inline-flex items-center justify-center rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 ${
              isRunning ? "animate-pulse" : ""
            }`}
          >
            {isRunning ? "Executando..." : "Executar agora"}
          </button>
        </div>
      </section>
      <section className="grid gap-5 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Total de monitores</p>
          <p className="mt-4 text-4xl font-semibold text-white">
            {summary ? summary.totalMonitors : "—"}
          </p>
          <p className="text-sm text-slate-500">Active endpoints</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Operacionais</p>
          <p className="mt-4 text-4xl font-semibold text-emerald-400">
            {summary ? summary.up : "—"}
          </p>
          <p className="text-sm text-slate-500">Healthy monitors</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Indisponíveis</p>
          <p className="mt-4 text-4xl font-semibold text-rose-400">
            {summary ? summary.down : "—"}
          </p>
          <p className="text-sm text-slate-500">Incidents open</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Monitores</p>
              <h2 className="text-2xl font-semibold">Sua frota</h2>
            </div>
            <Link
              href="/monitors"
              className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300"
            >
              View all
            </Link>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-xl">
            <div className="overflow-hidden rounded-xl border border-white/5 bg-slate-950/60">
              <div className="grid grid-cols-5 gap-2 px-3 py-2 text-xs font-semibold uppercase text-slate-400">
                <span className="col-span-2">Monitor</span>
                <span>IP</span>
                <span>Interval</span>
                <span>Status</span>
              </div>
              <div className="divide-y divide-white/5">
                {monitors.length ? (
                  monitors.slice(0, 6).map((monitor) => (
                    <div
                      key={monitor.id}
                      className="grid grid-cols-5 gap-2 px-3 py-3 text-sm text-slate-200"
                    >
                      <span className="col-span-2 font-semibold">{monitor.nickname}</span>
                      <span>{monitor.ip_address}</span>
                      <span>{monitor.ping_interval_seconds}s</span>
                      <span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            monitor.last_status === "DOWN"
                              ? "bg-rose-500/20 text-rose-300"
                              : "bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {monitor.last_status ?? "UP"}
                        </span>
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-3 text-sm text-slate-500">No monitors yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
            <div className="space-y-4">
          <h2 className="text-xs uppercase tracking-[0.4em] text-slate-400">Verificações recentes</h2>
          <div className="h-64 rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-xl">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="4 6" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis
                    domain={[0, 1]}
                    ticks={[0, 1]}
                    stroke="#94a3b8"
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", border: "none" }}
                    labelStyle={{ color: "#fff" }}
                    itemStyle={{ color: "#fff" }}
                  />
                  <Line type="monotone" dataKey="up" stroke="#22c55e" strokeWidth={2} dot />
                  <Line type="monotone" dataKey="down" stroke="#f43f5e" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-slate-500">Awaiting check history.</p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Latest incidents</h2>
          <Link href="/reports" className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
            Reports
          </Link>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-xl">
          <div className="divide-y divide-white/5">
            {(() => {
              const incidents = summary?.lastIncidents ?? [];
              if (!incidents.length) {
                return <p className="py-3 text-sm text-slate-500">No incidents yet.</p>;
              }
              return incidents.map((incident) => (
                <div key={incident.id} className="flex flex-col gap-1 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-white">
                        {incident.nickname ?? incident.monitorId}
                      </p>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                        {incident.ip ?? "Unknown IP"} • started {new Date(incident.startedAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        incident.resolvedAt ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                      }`}
                    >
                      {incident.resolvedAt ? "Resolved" : "Active"}
                    </span>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      </section>
    </div>
    </>
  );
}
