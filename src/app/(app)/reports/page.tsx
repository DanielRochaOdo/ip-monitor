"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast-provider";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useAuthReady, useSession } from "@/components/supabase-provider";

type CheckRecord = {
  id: string;
  monitor_id: string;
  checked_at: string;
  status: "UP" | "DOWN";
  latency_ms: number | null;
  error_message: string | null;
  monitors?: {
    nickname: string;
    ip_address: string;
  };
};

type Monitor = {
  id: string;
  nickname: string;
};

export default function ReportsPage() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [checks, setChecks] = useState<CheckRecord[]>([]);
  const [filters, setFilters] = useState({
    monitorId: "",
    status: "",
    from: "",
    to: "",
  });
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const session = useSession();
  const authReady = useAuthReady();
  const router = useRouter();

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
    fetch("/api/monitors", { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => setMonitors(data ?? []));
  }, [authHeaders, authReady, session?.access_token]);

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    query.set("limit", "40");
    if (filters.monitorId) query.set("monitorId", filters.monitorId);
    if (filters.status) query.set("status", filters.status);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    return query.toString();
  }, [filters]);

  const refreshChecks = useCallback(async () => {
    if (!authReady || !session?.access_token) {
      setChecks([]);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/reports/checks?${queryString}`, { headers: authHeaders });
      const data = await response.json();
      setChecks(data.checks ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load checks";
      toast.push({ title: "Unable to load checks", description: message, variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [queryString, toast, authHeaders, authReady, session?.access_token]);

  useEffect(() => {
    void refreshChecks();
  }, [refreshChecks]);

  const handleExport = async () => {
    if (!authReady || !session?.access_token) {
      toast.push({ title: "Faça login para exportar", variant: "error" });
      return;
    }
    const response = await fetch(`/api/reports/checks?${queryString}&format=csv`, { headers: authHeaders });
    if (!response.ok) {
      toast.push({ title: "Export failed", variant: "error" });
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "checks.csv";
    link.click();
    URL.revokeObjectURL(url);
    toast.push({ title: "CSV ready", variant: "success" });
  };

  const chartData = useMemo(
    () =>
      checks.slice(0, 12).map((check) => ({
        time: new Date(check.checked_at).toLocaleTimeString(),
        value: check.status === "DOWN" ? 0 : 1,
      })),
    [checks],
  );

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Relatórios</p>
            <h1 className="text-2xl font-semibold text-white">Verificações</h1>
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-950"
          >
            Exportar CSV
          </button>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <select
            value={filters.monitorId}
            onChange={(event) => setFilters((prev) => ({ ...prev, monitorId: event.target.value }))}
            className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
          >
            <option value="">Todos os monitores</option>
            {monitors.map((monitor) => (
              <option key={monitor.id} value={monitor.id}>
                {monitor.nickname}
              </option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
          >
            <option value="">Todos os status</option>
            <option value="UP">UP</option>
            <option value="DOWN">DOWN</option>
          </select>
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
            className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
            className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white">Tendência</h2>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Últimas verificações</p>
            <div className="mt-4 h-48">
              {chartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="4 6" stroke="#1e293b" />
                    <XAxis dataKey="time" stroke="#94a3b8" />
                    <YAxis domain={[0, 1]} ticks={[0, 1]} stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0f172a", border: "none" }}
                      labelStyle={{ color: "#fff" }}
                      itemStyle={{ color: "#fff" }}
                    />
                    <Line type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-slate-500">Ainda sem verificações.</p>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white">Registro de verificações</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-200">
              {loading ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : checks.length ? (
                checks.map((check) => (
                  <div key={check.id} className="flex items-center justify-between rounded-xl bg-slate-950/40 px-4 py-3">
                    <div>
                      <p className="font-semibold">{check.monitors?.nickname ?? check.monitor_id}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(check.checked_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          check.status === "DOWN"
                            ? "bg-rose-500/20 text-rose-300"
                            : "bg-emerald-500/20 text-emerald-300"
                        }`}
                      >
                        {check.status}
                      </span>
                    <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        {check.latency_ms ? `${check.latency_ms}ms` : "—"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
              <p className="text-sm text-slate-500">Nenhum registro encontrado.</p>
              )}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-white">Estatísticas</h2>
          <p className="mt-3 text-sm text-slate-400">
            Filtered results: <span className="font-semibold">{checks.length}</span>
          </p>
          <ul className="mt-4 space-y-3 text-sm text-slate-200">
            <li className="flex justify-between">
              <span>Last DOWN</span>
            <span className="text-emerald-300">
                {checks.filter((check) => check.status === "DOWN").length}
              </span>
            </li>
            <li className="flex justify-between">
              <span>Last UP</span>
              <span className="text-emerald-300">
                {checks.filter((check) => check.status === "UP").length}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
