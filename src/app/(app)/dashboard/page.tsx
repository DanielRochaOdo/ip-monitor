"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { runChecksAction } from "@/actions/runChecksAction";
import { useAuthReady, useSession, useSupabaseClient } from "@/components/supabase-provider";
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
  status: "UP" | "DOWN" | "DEGRADED" | null;
  agent_id: string | null;
  check_type: "TCP" | "HTTP" | "ICMP";
  last_checked_at: string | null;
};

type CheckPayload = {
  checked_at: string;
  status: "UP" | "DOWN" | "DEGRADED";
};

type DevicesPayload = {
  devices: Array<{
    device: {
      id: string;
      site: string;
      hostname: string | null;
      model: string | null;
      wan_public_ips: string[];
      lan_ip: string | null;
      mgmt_method: string;
    };
    latest: {
      checked_at: string;
      status: "UP" | "DOWN" | "DEGRADED";
      cpu_percent: number | null;
      mem_percent: number | null;
      sessions: number | null;
      uptime_seconds: number | null;
      wan1_ip: string | null;
      wan1_status: string | null;
      wan2_ip: string | null;
      wan2_status: string | null;
      error: string | null;
    } | null;
    run_request: {
      id: string;
      device_id: string;
      requested_at: string;
    } | null;
    backoff: {
      device_id: string;
      backoff_seconds: number;
      next_allowed_at: string | null;
      iface_next_allowed_at: string | null;
      rate_limit_count: number;
      last_error: string | null;
      reason: string | null;
      updated_at: string;
    } | null;
  }>;
};

export default function DashboardPage() {
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [monitors, setMonitors] = useState<MonitorPayload[]>([]);
  const [checks, setChecks] = useState<CheckPayload[]>([]);
  const [devices, setDevices] = useState<DevicesPayload["devices"]>([]);
  const [deviceRunNowPendingId, setDeviceRunNowPendingId] = useState<string | null>(null);

  const session = useSession();
  const supabase = useSupabaseClient();
  const authReady = useAuthReady();
  const toast = useToast();
  const router = useRouter();

  const [isPending, startTransition] = useTransition();
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

  const refresh = useCallback(async () => {
    if (!authReady || !session?.access_token) return;

    const [summaryRes, monitorsRes, checksRes, devicesRes] = await Promise.all([
      fetch("/api/reports/summary", { headers: authHeaders }),
      fetch("/api/monitors", { headers: authHeaders }),
      fetch("/api/reports/checks?limit=24", { headers: authHeaders }),
      fetch("/api/reports/devices", { headers: authHeaders }),
    ]);

    if (summaryRes.ok) setSummary((await summaryRes.json()) as SummaryPayload);
    if (monitorsRes.ok) setMonitors(((await monitorsRes.json()) as MonitorPayload[] | null) ?? []);
    if (checksRes.ok) {
      const data = (await checksRes.json()) as { checks?: CheckPayload[] } | null;
      setChecks(data?.checks ?? []);
    }
    if (devicesRes.ok) {
      const data = (await devicesRes.json()) as DevicesPayload | null;
      setDevices(data?.devices ?? []);
    }
  }, [authHeaders, authReady, session?.access_token]);

  const lastDeviceChecked = useMemo(() => {
    let best: { site: string; at: string } | null = null;
    for (const row of devices) {
      const at = row.latest?.checked_at ?? null;
      if (!at) continue;
      if (!best) {
        best = { site: row.device.site, at };
        continue;
      }
      if (new Date(at).getTime() > new Date(best.at).getTime()) {
        best = { site: row.device.site, at };
      }
    }
    return best;
  }, [devices]);

  const requestDeviceRunNow = useCallback(
    async (deviceId: string) => {
      if (!session?.access_token) return;
      setDeviceRunNowPendingId(deviceId);
      try {
        const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/run`, {
          method: "POST",
          headers: authHeaders,
        });
        const payload = (await res.json()) as { ok?: boolean; queued?: boolean; alreadyQueued?: boolean; error?: string };
        if (!res.ok) {
          throw new Error(payload?.error ?? "Falha ao solicitar verificacao");
        }
        toast.push({
          title: payload?.alreadyQueued ? "Verificacao manual ja estava na fila." : "Verificacao manual solicitada.",
          variant: "success",
        });
        // Refresh quickly so the UI shows "em fila" immediately.
        setTimeout(() => void refresh(), 500);
      } catch (e) {
        toast.push({
          title: "Falha ao solicitar verificacao",
          description: e instanceof Error ? e.message : "Erro desconhecido",
          variant: "error",
        });
      } finally {
        setDeviceRunNowPendingId(null);
      }
    },
    [authHeaders, refresh, session?.access_token, toast],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!authReady || !session?.access_token) return;
    const interval = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(interval);
  }, [authReady, refresh, session?.access_token]);

  const runNow = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setLastRunSummary(null);

    startTransition(async () => {
      try {
        const result = await runChecksAction();
        setLastRunAt(new Date().toLocaleString());
        const summaryText = `Verificados: ${result.checked} | Incidentes: +${result.incidentsCreated}/-${result.incidentsResolved} | Emails: ${result.notificationsSent}${result.errors?.length ? ` | Erros: ${result.errors.length}` : ""}`;
        setLastRunSummary(summaryText);
        toast.push({
          title: "Verificacoes executadas",
          description: result.errors?.length ? `${summaryText}\n${result.errors[0]}` : summaryText,
          variant: result.errors?.length ? "error" : "success",
        });
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao executar verificacoes";
        setLastRunAt(new Date().toLocaleString());
        setLastRunSummary(message);
        toast.push({ title: "Falha ao executar verificacoes", description: message, variant: "error" });
      } finally {
        runningRef.current = false;
      }
    });
  }, [refresh, startTransition, toast]);

  const chartData = useMemo(() => {
    const bucket: Record<string, { name: string; up: number; down: number }> = {};
    for (const check of checks) {
      const d = new Date(check.checked_at);
      const key = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
      if (!bucket[key]) bucket[key] = { name: key, up: 0, down: 0 };
      if (check.status === "DOWN") bucket[key].down += 1;
      else bucket[key].up += 1; // UP + DEGRADED
    }
    return Object.values(bucket).slice(-24);
  }, [checks]);

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Dashboard</p>
          <h1 className="text-2xl font-semibold text-white">Visao geral</h1>
          <p className="mt-1 text-sm text-slate-400">
            {lastRunAt ? `Ultima execucao manual: ${lastRunAt}` : "Execucoes automaticas rodam via cron/agent."}
          </p>
          {lastRunSummary ? <p className="mt-1 text-xs text-slate-500">{lastRunSummary}</p> : null}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/monitors"
            className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200"
          >
            Monitores
          </Link>
          <button
            type="button"
            onClick={runNow}
            disabled={isPending}
            className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {isPending ? "Executando..." : "Executar agora"}
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-xl">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Monitores</p>
          <p className="mt-2 text-3xl font-semibold text-white">{summary?.totalMonitors ?? "--"}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-xl">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">UP</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-300">{summary?.up ?? "--"}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-xl">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">DOWN</p>
          <p className="mt-2 text-3xl font-semibold text-rose-300">{summary?.down ?? "--"}</p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">FortiGate (LAN Agent)</h2>
          <Link href="/settings" className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
            Agentes
          </Link>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-xl">
          <div className="mb-4 flex flex-col gap-1 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <p>Automatico: round-robin (1 device por vez). Cadencia definida no agente (AGENT_DEVICE_STEP_SECONDS).</p>
            <p>
              Ultimo check:{" "}
              {lastDeviceChecked
                ? `${lastDeviceChecked.site} as ${new Date(lastDeviceChecked.at).toLocaleTimeString()}`
                : "--"}
            </p>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Dica: se aparecer 429 rate limit, aumente{" "}
            <code className="text-slate-300">AGENT_DEVICE_STEP_SECONDS</code> no LAN Agent (ex.: 300 = 5 min).
          </p>
          {devices.length ? (
            <div className="divide-y divide-white/5">
              {devices.map(({ device, latest, backoff, run_request }) => (
                <div key={device.id} className="flex flex-col gap-2 py-3 text-sm">
                  {/** backoff info */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-white">
                        {device.site} {device.hostname ? `- ${device.hostname}` : ""}
                      </p>
                      <p className="text-xs text-slate-400">
                        LAN: {device.lan_ip ?? "--"} | WAN(s): {(device.wan_public_ips ?? []).join(", ") || "--"}
                      </p>
                      {run_request?.requested_at ? (
                        <p className="text-xs text-slate-500">
                          Verificacao manual em fila desde{" "}
                          {new Date(run_request.requested_at).toLocaleTimeString()}.
                        </p>
                      ) : null}
                      {latest?.error ? <p className="text-xs text-slate-500">Erro: {latest.error}</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void requestDeviceRunNow(device.id)}
                        disabled={!!run_request || deviceRunNowPendingId === device.id}
                        className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                        title={run_request ? "Ja existe uma verificacao manual pendente para este device." : "Solicitar verificacao agora"}
                      >
                        {run_request ? "Em fila" : deviceRunNowPendingId === device.id ? "Solicitando..." : "Monitorar agora"}
                      </button>
                      <span
                        className={`h-fit rounded-full px-3 py-1 text-xs font-semibold ${
                          latest?.status === "DOWN"
                            ? "bg-rose-500/20 text-rose-300"
                            : latest?.status === "DEGRADED"
                              ? "bg-amber-500/20 text-amber-200"
                              : "bg-emerald-500/20 text-emerald-300"
                        }`}
                      >
                        {latest?.status ?? "--"}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-6">
                    <span>CPU: {latest?.cpu_percent ?? "--"}%</span>
                    <span>Mem: {latest?.mem_percent ?? "--"}%</span>
                    <span>Sessoes: {latest?.sessions ?? "--"}</span>
                    <span>WAN1: {latest?.wan1_status ?? "--"}</span>
                    <span>WAN2: {latest?.wan2_status ?? "--"}</span>
                    <span>Atualizado: {latest?.checked_at ? new Date(latest.checked_at).toLocaleTimeString() : "--"}</span>
                  </div>
                  {(() => {
                    const nextDevice = backoff?.next_allowed_at ?? null;
                    const nextIface = backoff?.iface_next_allowed_at ?? null;
                    const candidates = [nextDevice, nextIface].filter(Boolean) as string[];
                    if (!candidates.length) return null;
                    const nextMs = Math.max(...candidates.map((v) => new Date(v).getTime()).filter(Number.isFinite));
                    if (!Number.isFinite(nextMs)) return null;
                    const diffSec = Math.max(0, Math.round((nextMs - Date.now()) / 1000));
                    if (diffSec <= 0) return null;
                    const reason =
                      backoff?.reason ??
                      (nextIface && (!nextDevice || new Date(nextIface).getTime() >= new Date(nextDevice).getTime())
                        ? "iface cooldown"
                        : null);
                    return (
                      <p className="text-xs text-slate-500">
                        Proximo retry em {diffSec}s{reason ? ` (${reason})` : ""}
                      </p>
                    );
                  })()}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nenhum device cadastrado ainda.</p>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-xl font-semibold text-white">Monitores</h2>
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-xl">
            <div className="grid grid-cols-7 gap-2 px-3 py-2 text-xs font-semibold uppercase text-slate-400">
              <span className="col-span-2">Monitor</span>
              <span>Origem</span>
              <span>Tipo</span>
              <span>Intervalo</span>
              <span>Status</span>
              <span className="text-right">Acoes</span>
            </div>
            <div className="divide-y divide-white/5">
              {monitors.length ? (
                monitors.slice(0, 8).map((monitor) => {
                  const surface = monitor.status ?? (monitor.last_status ?? "UP");
                  const origin = monitor.agent_id ? "LAN" : "CLOUD";
                  return (
                    <div key={monitor.id} className="grid grid-cols-7 gap-2 px-3 py-3 text-sm text-slate-200">
                      <span className="col-span-2 font-semibold">
                        <Link href={`/monitors/${monitor.id}`} className="hover:underline">
                          {monitor.nickname}
                        </Link>
                      </span>
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-400">{origin}</span>
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-400">{monitor.check_type}</span>
                      <span>{monitor.ping_interval_seconds}s</span>
                      <span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            surface === "DOWN"
                              ? "bg-rose-500/20 text-rose-300"
                              : surface === "DEGRADED"
                                ? "bg-amber-500/20 text-amber-200"
                                : "bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {surface}
                        </span>
                      </span>
                      <span className="text-right">
                        <Link
                          href={`/monitors/${monitor.id}`}
                          className="rounded-full border border-emerald-500/40 px-3 py-1 text-xs font-semibold text-emerald-200"
                        >
                          Editar
                        </Link>
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="px-3 py-3 text-sm text-slate-500">Nenhum monitor ainda.</div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold text-white">Verificacoes recentes</h2>
          <div className="h-64 rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-xl">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="4 6" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis domain={[0, "dataMax + 1"]} stroke="#94a3b8" axisLine={false} tickLine={false} />
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
              <p className="text-sm text-slate-500">Aguardando historico de checks.</p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Ultimos incidentes</h2>
          <Link href="/reports" className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
            Relatorios
          </Link>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-xl">
          <div className="divide-y divide-white/5">
            {(() => {
              const incidents = summary?.lastIncidents ?? [];
              if (!incidents.length) {
                return <p className="py-3 text-sm text-slate-500">Nenhum incidente ainda.</p>;
              }
              return incidents.map((incident) => (
                <div key={incident.id} className="flex flex-col gap-1 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-white">{incident.nickname ?? incident.monitorId}</p>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                        {incident.ip ?? "--"} | inicio {new Date(incident.startedAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        incident.resolvedAt ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                      }`}
                    >
                      {incident.resolvedAt ? "Resolvido" : "Ativo"}
                    </span>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      </section>
    </div>
  );
}
