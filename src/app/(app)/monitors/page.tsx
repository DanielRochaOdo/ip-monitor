"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast-provider";
import { useAuthReady, useSession, useSupabaseClient } from "@/components/supabase-provider";

type AgentRow = {
  id: string;
  name: string;
  site: string;
  is_active: boolean;
};

type MonitorResponse = {
  id: string;
  nickname: string;
  ip_address: string;
  ping_interval_seconds: number;
  failure_threshold: number;
  success_threshold: number;
  is_active: boolean;
  last_status: "UP" | "DOWN" | null;
  status: "UP" | "DOWN" | "DEGRADED" | null;
  check_type: "TCP" | "HTTP" | "ICMP";
  ports: number[];
  port: number | null;
  http_url: string | null;
  http_method: "GET" | "HEAD" | null;
  http_expected_status: number | null;
  agent_id: string | null;
  is_private: boolean;
};

export default function MonitorsPage() {
  const [monitors, setMonitors] = useState<MonitorResponse[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    nickname: "",
    ip_address: "",
    ping_interval_seconds: 60,
    failure_threshold: 2,
    success_threshold: 1,
    check_type: "TCP" as "TCP" | "HTTP" | "ICMP",
    agent_id: "cloud" as "cloud" | string,
    ports: "80,443",
    http_url: "",
    http_method: "GET" as "GET" | "HEAD",
    http_expected_status: 200,
  });

  const toast = useToast();
  const session = useSession();
  const supabase = useSupabaseClient();
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

  const refreshAgents = useCallback(async () => {
    if (!authReady || !session?.access_token) {
      setAgents([]);
      return;
    }

    const res = await fetch("/api/agents", { headers: authHeaders });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      setAgents([]);
      return;
    }
    setAgents((payload as AgentRow[] | null) ?? []);
  }, [authHeaders, authReady, session?.access_token]);

  const refreshMonitors = useCallback(async () => {
    if (!authReady || !session?.access_token) {
      setMonitors([]);
      return;
    }

    const response = await fetch("/api/monitors", { headers: authHeaders });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: unknown }).error ?? "Falha ao carregar")
          : "Falha ao carregar";
      toast.push({ title: "Falha ao carregar monitores", description: message, variant: "error" });
      setMonitors([]);
      return;
    }

    setMonitors((payload as MonitorResponse[] | null) ?? []);
  }, [authHeaders, authReady, session?.access_token, toast]);

  useEffect(() => {
    if (!authReady || !session?.access_token) return;
    void refreshAgents();
    void refreshMonitors();
  }, [authReady, refreshAgents, refreshMonitors, session?.access_token]);

  // Keep the list up-to-date while cloud cron / LAN agents run in the background.
  useEffect(() => {
    if (!authReady || !session?.access_token) return;
    const interval = setInterval(() => void refreshMonitors(), 30_000);
    return () => clearInterval(interval);
  }, [authReady, refreshMonitors, session?.access_token]);

  const filteredMonitors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return monitors;
    return monitors.filter(
      (monitor) =>
        monitor.nickname.toLowerCase().includes(q) || monitor.ip_address.toLowerCase().includes(q),
    );
  }, [monitors, search]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.access_token) {
      toast.push({ title: "Faca login para gerenciar monitores", variant: "error" });
      return;
    }
    setCreating(true);

    const ports = form.ports
      .split(",")
      .map((p) => Number(p.trim()))
      .filter((p) => Number.isFinite(p) && p > 0);

    const payload = {
      nickname: form.nickname,
      ip_address: form.ip_address,
      ping_interval_seconds: Number(form.ping_interval_seconds),
      failure_threshold: Number(form.failure_threshold),
      success_threshold: Number(form.success_threshold),
      check_type: form.check_type,
      agent_id: form.agent_id === "cloud" ? null : form.agent_id,
      ports,
      http_url: form.http_url ? form.http_url : null,
      http_method: form.http_method,
      http_expected_status: Number(form.http_expected_status),
    };

    const response = await fetch("/api/monitors", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(payload),
    });

    setCreating(false);

    const responsePayload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        responsePayload && typeof responsePayload === "object" && "error" in responsePayload
          ? String((responsePayload as { error?: unknown }).error ?? "Erro")
          : "Erro";
      toast.push({ title: "Nao foi possivel criar o monitor", description: message, variant: "error" });
      return;
    }

    toast.push({ title: "Monitor criado", variant: "success" });
    setForm((prev) => ({ ...prev, nickname: "", ip_address: "" }));
    await refreshMonitors();
  };

  const deleteMonitor = async (id: string) => {
    if (!session?.access_token) return;
    const response = await fetch(`/api/monitors/${id}`, { method: "DELETE", headers: authHeaders });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: unknown }).error ?? "Erro ao excluir")
          : "Erro ao excluir";
      toast.push({ title: "Erro ao excluir", description: message, variant: "error" });
      return;
    }
    toast.push({ title: "Monitor excluido", variant: "success" });
    await refreshMonitors();
  };

  const toggleMonitor = async (id: string, currentlyActive: boolean) => {
    if (!session?.access_token) return;
    const response = await fetch(`/api/monitors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ is_active: !currentlyActive }),
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: unknown }).error ?? "Erro ao atualizar")
          : "Erro ao atualizar";
      toast.push({ title: "Erro", description: message, variant: "error" });
      return;
    }
    await refreshMonitors();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Monitores</p>
        <h1 className="text-2xl font-semibold text-white">Cadastro</h1>

        <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={handleCreate}>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Apelido</label>
            <input
              value={form.nickname}
              onChange={(event) => setForm((prev) => ({ ...prev, nickname: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="Ex: FW Parangaba"
              required
            />
            <p className="text-xs text-slate-500">Nome amigavel exibido no painel e nos alertas.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">IP</label>
            <input
              value={form.ip_address}
              onChange={(event) => setForm((prev) => ({ ...prev, ip_address: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="Ex: 177.200.87.218"
              required
            />
            <p className="text-xs text-slate-500">
              IP do alvo. Para 10.x/192.168.x/172.16-31.x use um Agente LAN.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Origem</label>
            <select
              value={form.agent_id}
              onChange={(event) => setForm((prev) => ({ ...prev, agent_id: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            >
              <option value="cloud">Cloud (externo)</option>
              {agents
                .filter((a) => a.is_active)
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    LAN Agent: {agent.site} ({agent.name})
                  </option>
                ))}
            </select>
            <p className="text-xs text-slate-500">Onde o check roda: cloud valida WAN; LAN agent valida IP privado/ICMP/API.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Tipo de check</label>
            <select
              value={form.check_type}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "TCP" || value === "HTTP" || value === "ICMP") {
                  setForm((prev) => ({ ...prev, check_type: value }));
                }
              }}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            >
              <option value="TCP">TCP</option>
              <option value="HTTP">HTTP</option>
              <option value="ICMP">ICMP (ping)</option>
            </select>
            <p className="text-xs text-slate-500">
              TCP/HTTP funcionam no cloud; ICMP e recomendado via LAN agent.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Intervalo (segundos)</label>
            <input
              type="number"
              min={60}
              value={form.ping_interval_seconds}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, ping_interval_seconds: Number(event.target.value) }))
              }
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
            <p className="text-xs text-slate-500">Frequencia das verificacoes (minimo 60s).</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Falhas para DOWN</label>
            <input
              type="number"
              min={1}
              value={form.failure_threshold}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, failure_threshold: Number(event.target.value) }))
              }
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
            <p className="text-xs text-slate-500">Quantas falhas consecutivas para marcar DOWN (evita falso positivo).</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Sucessos para UP</label>
            <input
              type="number"
              min={1}
              value={form.success_threshold}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, success_threshold: Number(event.target.value) }))
              }
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
            <p className="text-xs text-slate-500">Quantos sucessos consecutivos para sair de DOWN (evita flapping).</p>
          </div>

          {form.check_type === "TCP" ? (
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Portas (TCP)</label>
              <input
                value={form.ports}
                onChange={(event) => setForm((prev) => ({ ...prev, ports: event.target.value }))}
                placeholder="Ex: 443,80,22"
                className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              />
              <p className="text-xs text-slate-500">
                Lista de portas testadas. Se conectar: UP. Se recusar (ECONNREFUSED): DEGRADED (LAN) / UP (cloud).
              </p>
            </div>
          ) : null}

          {form.check_type === "HTTP" ? (
            <>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs uppercase tracking-[0.4em] text-slate-400">URL (HTTP)</label>
                <input
                  value={form.http_url}
                  onChange={(event) => setForm((prev) => ({ ...prev, http_url: event.target.value }))}
                  placeholder="Ex: https://177.200.87.218/"
                  className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
                />
                <p className="text-xs text-slate-500">URL usada no check HTTP. Para HTTPS self-signed, prefira LAN agent.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Metodo</label>
                <select
                  value={form.http_method}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "GET" || value === "HEAD") {
                      setForm((prev) => ({ ...prev, http_method: value }));
                    }
                  }}
                  className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
                >
                  <option value="GET">GET</option>
                  <option value="HEAD">HEAD</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Status esperado</label>
                <input
                  type="number"
                  min={100}
                  max={599}
                  value={form.http_expected_status}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, http_expected_status: Number(event.target.value) }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
                />
              </div>
            </>
          ) : null}

          <button
            type="submit"
            disabled={creating}
            className="md:col-span-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold uppercase tracking-[0.3em] text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? "Salvando..." : "Adicionar monitor"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Lista de monitores</h2>
            <p className="text-sm text-slate-400">Mostra checks Cloud e LAN Agent.</p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por apelido ou IP..."
            className="w-full max-w-sm rounded-full border border-white/10 bg-slate-950/50 px-4 py-2 text-sm text-slate-200"
          />
        </div>

        <div className="mt-4 space-y-4">
          {filteredMonitors.length ? (
            filteredMonitors.map((monitor) => {
              const surface = monitor.status ?? (monitor.last_status ?? "UP");
              const origin = monitor.agent_id ? "LAN" : "CLOUD";
              return (
                <div
                  key={monitor.id}
                  className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1 text-sm text-slate-200">
                    <p className="text-base font-semibold text-white">{monitor.nickname}</p>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{monitor.ip_address}</p>
                    <p className="text-xs text-slate-400">
                      {origin} • {monitor.check_type} • {monitor.ping_interval_seconds}s
                      {monitor.is_private ? " • privado" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
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
                    <button
                      type="button"
                      onClick={() => toggleMonitor(monitor.id, monitor.is_active)}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-slate-200"
                    >
                      {monitor.is_active ? "Pausar" : "Retomar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMonitor(monitor.id)}
                      className="rounded-full border border-rose-500/40 px-3 py-1 text-xs font-semibold text-rose-200"
                    >
                      Excluir
                    </button>
                    <Link
                      href={`/monitors/${monitor.id}`}
                      className="rounded-full border border-emerald-500/40 px-3 py-1 text-xs font-semibold text-emerald-200"
                    >
                      Detalhes
                    </Link>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-slate-500">Nenhum monitor encontrado.</p>
          )}
        </div>
      </div>
    </div>
  );
}
