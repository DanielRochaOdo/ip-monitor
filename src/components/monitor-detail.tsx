"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useToast } from "@/components/toast-provider";
import { useSession } from "@/components/supabase-provider";

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
  const [formState, setFormState] = useState({
    nickname: monitor.nickname,
    ping_interval_seconds: monitor.ping_interval_seconds,
    failure_threshold: monitor.failure_threshold,
    success_threshold: monitor.success_threshold,
    ports: monitor.ports.join(","),
    http_url: monitor.http_url ?? "",
    http_method: (monitor.http_method ?? "GET") as "GET" | "HEAD",
    http_expected_status: monitor.http_expected_status ?? 200,
    is_active: monitor.is_active,
  });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const session = useSession();

  const authHeaders = useMemo(() => {
    if (!session?.access_token) return {};
    return {
      Authorization: `Bearer ${session.access_token}`,
      ...(session.refresh_token ? { "x-refresh-token": session.refresh_token } : {}),
    };
  }, [session]);

  const ensureAuth = useCallback(() => {
    if (!session?.access_token) {
      toast.push({ title: "Faca login para editar monitores", variant: "error" });
      return false;
    }
    return true;
  }, [session?.access_token, toast]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ensureAuth()) return;
    setSaving(true);

    const payload: Record<string, unknown> = {
      nickname: formState.nickname,
      ping_interval_seconds: Number(formState.ping_interval_seconds),
      failure_threshold: Number(formState.failure_threshold),
      success_threshold: Number(formState.success_threshold),
      is_active: formState.is_active,
    };

    if (monitor.check_type === "TCP") {
      payload.ports = formState.ports
        .split(",")
        .map((port) => Number(port.trim()))
        .filter((p) => Number.isFinite(p) && p > 0);
    }

    if (monitor.check_type === "HTTP") {
      payload.http_url = formState.http_url;
      payload.http_method = formState.http_method;
      payload.http_expected_status = Number(formState.http_expected_status);
    }

    const response = await fetch(`/api/monitors/${monitor.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(payload),
    });

    setSaving(false);
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "error" in data
          ? String((data as { error?: unknown }).error ?? "Tente novamente")
          : "Tente novamente";
      toast.push({ title: "Falha ao atualizar", description: message, variant: "error" });
      return;
    }

    toast.push({ title: "Monitor atualizado", variant: "success" });
  };

  const surface = monitor.status ?? (monitor.last_status ?? "UP");
  const origin = monitor.agent_id ? "LAN" : "CLOUD";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Detalhes do monitor</p>
          <h1 className="text-2xl font-semibold text-white">{monitor.nickname}</h1>
          <p className="text-sm text-slate-400">
            {monitor.ip_address} • {origin} • {monitor.check_type}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Status: <span className="font-semibold text-slate-200">{surface}</span>
            {monitor.last_checked_at ? ` • Ultimo check: ${new Date(monitor.last_checked_at).toLocaleString()}` : ""}
          </p>
          {monitor.last_error ? (
            <p className="mt-1 text-xs text-slate-500">Ultimo erro: {monitor.last_error}</p>
          ) : null}
        </div>
        <Link
          href="/monitors"
          className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300"
        >
          Voltar
        </Link>
      </div>

      <form
        className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl"
        onSubmit={handleSubmit}
      >
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

          {monitor.check_type === "TCP" ? (
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Portas</label>
              <input
                value={formState.ports}
                onChange={(event) => setFormState((prev) => ({ ...prev, ports: event.target.value }))}
                placeholder="Ex: 443,80,22"
                className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              />
            </div>
          ) : null}

          {monitor.check_type === "HTTP" ? (
            <>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs uppercase tracking-[0.4em] text-slate-400">URL</label>
                <input
                  value={formState.http_url}
                  onChange={(event) => setFormState((prev) => ({ ...prev, http_url: event.target.value }))}
                  placeholder="Ex: https://..."
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
            {saving ? "Salvando..." : "Salvar"}
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
