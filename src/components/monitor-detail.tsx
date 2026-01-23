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
    ports: number[];
    is_active: boolean;
    last_status: "UP" | "DOWN" | null;
    last_checked_at: string | null;
  };
  checks: {
    id: string;
    checked_at: string;
    status: "UP" | "DOWN";
    latency_ms: number | null;
    error_message: string | null;
  }[];
};

export function MonitorDetail({ monitor, checks }: MonitorDetailProps) {
  const [formState, setFormState] = useState({
    nickname: monitor.nickname,
    ping_interval_seconds: monitor.ping_interval_seconds,
    failure_threshold: monitor.failure_threshold,
    ports: monitor.ports.join(","),
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
      toast.push({ title: "Faça login para editar monitores", variant: "error" });
      return false;
    }
    return true;
  }, [session?.access_token, toast]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ensureAuth()) return;
    setSaving(true);
    const payload = {
      nickname: formState.nickname,
      ping_interval_seconds: Number(formState.ping_interval_seconds),
      failure_threshold: Number(formState.failure_threshold),
      ports: formState.ports.split(",").map((port) => Number(port.trim())),
      is_active: formState.is_active,
    };

    const response = await fetch(`/api/monitors/${monitor.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(payload),
    });

    setSaving(false);
    if (!response.ok) {
      const data = await response.json();
      toast.push({ title: "Update failed", description: data.error ?? "Try again", variant: "error" });
      return;
    }

    toast.push({ title: "Monitor updated", variant: "success" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Detalhes do monitor</p>
          <h1 className="text-2xl font-semibold text-white">{monitor.nickname}</h1>
          <p className="text-sm text-slate-500">{monitor.ip_address}</p>
        </div>
        <Link
          href="/monitors"
          className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300"
        >
          Voltar à lista
        </Link>
      </div>

      <form className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Apelido</label>
            <input
              value={formState.nickname}
              onChange={(event) => setFormState((prev) => ({ ...prev, nickname: event.target.value }))}
              placeholder="Ex: Servidor ERP"
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
            <p className="text-xs text-slate-500">Nome amigável exibido nos alertas e relatórios.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Intervalo (seg)</label>
            <input
              type="number"
              min={60}
              value={formState.ping_interval_seconds}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  ping_interval_seconds: Number(event.target.value),
                }))
              }
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
            <p className="text-xs text-slate-500">Tempo entre verificações. Mínimo 60s.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Limite</label>
            <input
              type="number"
              min={1}
              value={formState.failure_threshold}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, failure_threshold: Number(event.target.value) }))
              }
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
            <p className="text-xs text-slate-500">Falhas consecutivas para considerar DOWN. Padrão: 2.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Portas</label>
            <input
              value={formState.ports}
              onChange={(event) => setFormState((prev) => ({ ...prev, ports: event.target.value }))}
              placeholder="Ex: 80,443"
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
            <p className="text-xs text-slate-500">Lista de portas TCP testadas (separadas por vírgula).</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
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
              {saving ? "Salvando…" : "Salvar alterações"}
            </button>
        </div>
      </form>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Verificações recentes</h2>
          <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
            {checks.length} entradas
          </span>
        </div>
        <div className="mt-4 divide-y divide-white/5 text-sm text-slate-200">
          {checks.length ? (
            checks.map((check) => (
              <div key={check.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-semibold">
                    {check.status === "UP" ? "Disponível" : "Indisponível"} •{" "}
                    {new Date(check.checked_at).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-400">
                    Latência: {check.latency_ms ? `${check.latency_ms}ms` : "—"} •{" "}
                    {check.error_message ? check.error_message : "Sem erros"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    check.status === "DOWN"
                      ? "bg-rose-500/20 text-rose-300"
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
