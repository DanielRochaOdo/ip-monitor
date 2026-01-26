"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast-provider";
import { useSession } from "@/components/supabase-provider";

type AgentRow = {
  id: string;
  name: string;
  site: string;
  is_active: boolean;
};

type MonitorDetailProps = {
  monitor: {
    id: string;
    nickname: string;
    ip_address: string;
    ping_interval_seconds: number;
    failure_threshold: number;
    success_threshold: number;
    check_type: "TCP" | "HTTP" | "ICMP";
    ports: number[];
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
  checks: {
    id: string;
    checked_at: string;
    status: "UP" | "DOWN" | "DEGRADED";
    latency_ms: number | null;
    error_message: string | null;
    source: "CLOUD" | "LAN";
    check_method: string | null;
  }[];
};

export function MonitorDetail({ monitor, checks }: MonitorDetailProps) {
  const toast = useToast();
  const session = useSession();
  const router = useRouter();

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formState, setFormState] = useState(() => ({
    nickname: monitor.nickname,
    ip_address: monitor.ip_address,
    ping_interval_seconds: monitor.ping_interval_seconds,
    failure_threshold: monitor.failure_threshold,
    success_threshold: monitor.success_threshold,
    check_type: monitor.check_type,
    origin: (monitor.agent_id ?? "cloud") as "cloud" | string,
    ports: monitor.ports.join(","),
    http_url: monitor.http_url ?? "",
    http_method: (monitor.http_method ?? "GET") as "GET" | "HEAD",
    http_expected_status: monitor.http_expected_status ?? 200,
    is_active: monitor.is_active,
  }));

  const authHeaders = useMemo(() => {
    if (!session?.access_token) return {};
    return {
      Authorization: `Bearer ${session.access_token}`,
      ...(session.refresh_token ? { "x-refresh-token": session.refresh_token } : {}),
    };
  }, [session]);

  useEffect(() => {
    if (!session?.access_token) return;

    let cancelled = false;
    setLoadingAgents(true);
    fetch("/api/agents", { headers: authHeaders })
      .then(async (res) => (await res.json()) as AgentRow[] | { error?: string } | null)
      .then((payload) => {
        if (cancelled) return;
        if (!payload || !Array.isArray(payload)) {
          setAgents([]);
          return;
        }
        setAgents(payload);
      })
      .catch(() => {
        if (cancelled) return;
        setAgents([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingAgents(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authHeaders, session?.access_token]);

  const ensureAuth = useCallback(() => {
    if (!session?.access_token) {
      toast.push({ title: "Faca login para editar monitores", variant: "error" });
      router.replace("/login");
      return false;
    }
    return true;
  }, [router, session?.access_token, toast]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ensureAuth()) return;

    setSaving(true);

    const checkType = formState.check_type;
    const agentId = formState.origin === "cloud" ? null : formState.origin;

    const payload: Record<string, unknown> = {
      nickname: formState.nickname,
      ip_address: formState.ip_address,
      ping_interval_seconds: Number(formState.ping_interval_seconds),
      failure_threshold: Number(formState.failure_threshold),
      success_threshold: Number(formState.success_threshold),
      check_type: checkType,
      agent_id: agentId,
      is_active: formState.is_active,
    };

    if (checkType === "TCP") {
      payload.ports = formState.ports
        .split(",")
        .map((port) => Number(port.trim()))
        .filter((p) => Number.isFinite(p) && p > 0);
      payload.http_url = null;
      payload.http_method = null;
      payload.http_expected_status = null;
    } else if (checkType === "HTTP") {
      payload.http_url = formState.http_url ? formState.http_url : null;
      payload.http_method = formState.http_method;
      payload.http_expected_status = Number(formState.http_expected_status);
      payload.ports = monitor.ports; // keep as-is in DB for now
    } else {
      // ICMP
      payload.http_url = null;
      payload.http_method = null;
      payload.http_expected_status = null;
    }

    const response = await fetch(`/api/monitors/${monitor.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(payload),
    });

    const data: unknown = await response.json().catch(() => null);
    setSaving(false);

    if (!response.ok) {
      const message =
        data && typeof data === "object" && data !== null && "error" in data
          ? String((data as { error?: unknown }).error ?? "Tente novamente")
          : "Tente novamente";
      toast.push({ title: "Falha ao atualizar", description: message, variant: "error" });
      return;
    }

    toast.push({ title: "Monitor atualizado", variant: "success" });
    // Reload to re-fetch the monitor + checks after updates.
    window.location.reload();
  };

  const surface = monitor.status ?? (monitor.last_status ?? "UP");
  const originLabel = monitor.agent_id ? "LAN" : "CLOUD";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Monitor</p>
          <h1 className="text-2xl font-semibold text-white">{monitor.nickname}</h1>
          <p className="text-sm text-slate-400">
            {monitor.ip_address} • {originLabel} • {monitor.check_type}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Status: <span className="font-semibold text-slate-200">{surface}</span>
            {monitor.last_checked_at ? ` • Ultimo check: ${new Date(monitor.last_checked_at).toLocaleString()}` : ""}
          </p>
          {monitor.last_error ? <p className="mt-1 text-xs text-slate-500">Ultimo erro: {monitor.last_error}</p> : null}
        </div>
        <Link
          href="/monitors"
          className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300"
        >
          Voltar
        </Link>
      </div>

      <form className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Apelido</label>
            <input
              value={formState.nickname}
              onChange={(event) => setFormState((prev) => ({ ...prev, nickname: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">IP</label>
            <input
              value={formState.ip_address}
              onChange={(event) => setFormState((prev) => ({ ...prev, ip_address: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
            <p className="text-xs text-slate-500">Altere com cuidado. IPs 10.x/192.168.x precisam de LAN Agent.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Origem</label>
            <select
              value={formState.origin}
              onChange={(event) => setFormState((prev) => ({ ...prev, origin: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            >
              <option value="cloud">Cloud (externo)</option>
              {agents
                .filter((a) => a.is_active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    LAN Agent: {a.site} ({a.name})
                  </option>
                ))}
            </select>
            <p className="text-xs text-slate-500">
              {loadingAgents ? "Carregando agentes..." : "Cloud valida WAN publica; LAN Agent valida IP privado e ICMP real."}
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Tipo</label>
            <select
              value={formState.check_type}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "TCP" || value === "HTTP" || value === "ICMP") {
                  setFormState((prev) => ({ ...prev, check_type: value }));
                }
              }}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            >
              <option value="TCP">TCP</option>
              <option value="HTTP">HTTP</option>
              <option value="ICMP">ICMP (ping)</option>
            </select>
            <p className="text-xs text-slate-500">Para ICMP em producao, use LAN Agent.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Intervalo (seg)</label>
            <input
              type="number"
              min={60}
              value={formState.ping_interval_seconds}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, ping_interval_seconds: Number(event.target.value) }))
              }
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Falhas para DOWN</label>
            <input
              type="number"
              min={1}
              value={formState.failure_threshold}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, failure_threshold: Number(event.target.value) }))
              }
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Sucessos para UP</label>
            <input
              type="number"
              min={1}
              value={formState.success_threshold}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, success_threshold: Number(event.target.value) }))
              }
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
          </div>

          {formState.check_type === "TCP" ? (
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Portas</label>
              <input
                value={formState.ports}
                onChange={(event) => setFormState((prev) => ({ ...prev, ports: event.target.value }))}
                placeholder="Ex: 443,80,22"
                className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              />
              <p className="text-xs text-slate-500">Separadas por virgula. Para WAN, use 443/80 se existir algo respondendo.</p>
            </div>
          ) : null}

          {formState.check_type === "HTTP" ? (
            <>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs uppercase tracking-[0.4em] text-slate-400">URL</label>
                <input
                  value={formState.http_url}
                  onChange={(event) => setFormState((prev) => ({ ...prev, http_url: event.target.value }))}
                  placeholder="Ex: https://seu-endpoint/"
                  className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Metodo</label>
                <select
                  value={formState.http_method}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "GET" || value === "HEAD") {
                      setFormState((prev) => ({ ...prev, http_method: value }));
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
                  value={formState.http_expected_status}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, http_expected_status: Number(event.target.value) }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
                />
              </div>
            </>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={formState.is_active}
              onChange={(event) => setFormState((prev) => ({ ...prev, is_active: event.target.checked }))}
            />
            Ativo
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-emerald-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Salvar alteracoes"}
          </button>
        </div>
      </form>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Verificacoes recentes</h2>
          <span className="text-xs uppercase tracking-[0.3em] text-slate-400">{checks.length} entradas</span>
        </div>
        <div className="mt-4 divide-y divide-white/5 text-sm text-slate-200">
          {checks.length ? (
            checks.map((check) => (
              <div key={check.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">
                    {check.status} • {check.source} {check.check_method ? `(${check.check_method})` : ""} •{" "}
                    {new Date(check.checked_at).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-400">
                    Latencia: {check.latency_ms ? `${check.latency_ms}ms` : "--"} •{" "}
                    {check.error_message ? check.error_message : "OK"}
                  </p>
                </div>
                <span
                  className={`h-fit rounded-full px-3 py-1 text-xs font-semibold ${
                    check.status === "DOWN"
                      ? "bg-rose-500/20 text-rose-300"
                      : check.status === "DEGRADED"
                        ? "bg-amber-500/20 text-amber-200"
                        : "bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  {check.status}
                </span>
              </div>
            ))
          ) : (
            <p className="py-3 text-xs text-slate-500">Aguardando registros...</p>
          )}
        </div>
      </div>
    </div>
  );
}
