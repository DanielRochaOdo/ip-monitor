/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast-provider";
import { useAuthReady, useSession } from "@/components/supabase-provider";

type MonitorResponse = {
  id: string;
  nickname: string;
  ip_address: string;
  ping_interval_seconds: number;
  failure_threshold: number;
  is_active: boolean;
  last_status: "UP" | "DOWN" | null;
  ports: number[];
};

export default function MonitorsPage() {
  const [monitors, setMonitors] = useState<MonitorResponse[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    nickname: "",
    ip_address: "",
    ping_interval_seconds: 60,
    failure_threshold: 2,
    ports: "80,443",
  });
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const session = useSession();
  const authReady = useAuthReady();
  const router = useRouter();

  const authHeaders = useMemo(() => {
    if (!session?.access_token) {
      return {};
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.access_token}`,
    };
    if (session.refresh_token) {
      headers["x-refresh-token"] = session.refresh_token;
    }
    return headers;
  }, [session]);

  useEffect(() => {
    if (!authReady) return;
    if (!session?.access_token) {
      router.replace("/login");
    }
  }, [authReady, router, session?.access_token]);

  const refreshMonitors = useCallback(async () => {
    if (!authReady || !session?.access_token) {
      setMonitors([]);
      return;
    }

    const response = await fetch("/api/monitors", {
      headers: authHeaders,
    });
    if (!response.ok) {
      let message: string | null = null;
      try {
        const payload = await response.json();
        message = payload?.error ?? null;
      } catch {
        // ignore
      }
      toast.push({
        title: "Falha ao carregar monitores",
        description: message ?? "Tente novamente",
        variant: "error",
      });
      setMonitors([]);
      return;
    }

    const data = await response.json();
    setMonitors(data ?? []);
  }, [authHeaders, authReady, session?.access_token, toast]);

  useEffect(() => {
    if (!authReady || !session?.access_token) return;
    void refreshMonitors();
  }, [authReady, refreshMonitors, session?.access_token]);

  // Keep the list up-to-date while cron runs in the background.
  useEffect(() => {
    if (!authReady || !session?.access_token) return;
    const interval = setInterval(() => void refreshMonitors(), 30_000);
    return () => clearInterval(interval);
  }, [authReady, refreshMonitors, session?.access_token]);

  const filteredMonitors = useMemo(() => {
    if (!search) return monitors;
    return monitors.filter(
      (monitor) =>
        monitor.nickname.toLowerCase().includes(search.toLowerCase()) ||
        monitor.ip_address.includes(search),
    );
  }, [monitors, search]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.access_token) {
      toast.push({ title: "Faça login para gerenciar monitores", variant: "error" });
      return;
    }
    setCreating(true);

    const payload = {
      ...form,
      ping_interval_seconds: Number(form.ping_interval_seconds),
      failure_threshold: Number(form.failure_threshold),
      ports: form.ports.split(",").map((port) => Number(port.trim())),
    };

    const response = await fetch("/api/monitors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(payload),
    });

    setCreating(false);

    if (!response.ok) {
      let message: string | null = null;
      try {
        const payload: unknown = await response.json();
        if (payload && typeof payload === "object" && "error" in payload) {
          const maybeError = (payload as { error?: unknown }).error;
          if (typeof maybeError === "string") {
            message = maybeError;
          } else if (Array.isArray(maybeError)) {
            message = maybeError.filter((item) => typeof item === "string").join(", ");
          }
        }
      } catch {
        // ignore
      }
      toast.push({
        title: "Unable to create monitor",
        description: message ?? "Try again",
        variant: "error",
      });
      return;
    }

    toast.push({ title: "Monitor added", variant: "success" });
    setForm({
      nickname: "",
      ip_address: "",
      ping_interval_seconds: 60,
      failure_threshold: 2,
      ports: "80,443",
    });
    refreshMonitors();
  };

  const toggleMonitor = async (id: string, isActive: boolean) => {
    if (!session?.access_token) {
      toast.push({ title: "Faça login para gerenciar monitores", variant: "error" });
      return;
    }
    const response = await fetch(`/api/monitors/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ is_active: !isActive }),
    });
    if (!response.ok) {
      let message: string | null = null;
      try {
        const payload = await response.json();
        message = payload?.error ?? null;
      } catch {
        // ignore
      }
      toast.push({
        title: "Falha ao atualizar monitor",
        description: message ?? "Tente novamente",
        variant: "error",
      });
      return;
    }
    await refreshMonitors();
  };

  const deleteMonitor = async (id: string) => {
    if (!session?.access_token) {
      toast.push({ title: "Faça login para gerenciar monitores", variant: "error" });
      return;
    }
    if (!confirm("Are you sure you want to delete this monitor?")) return;
    const response = await fetch(`/api/monitors/${id}`, {
      method: "DELETE",
      headers: authHeaders,
    });

    if (!response.ok) {
      let message: string | null = null;
      try {
        const payload = await response.json();
        message = payload?.error ?? null;
      } catch {
        // ignore
      }
      toast.push({
        title: "Falha ao excluir monitor",
        description: message ?? "Tente novamente",
        variant: "error",
      });
      return;
    }

    toast.push({ title: "Monitor removido", variant: "success" });
    await refreshMonitors();
  };

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Monitores</p>
          <h1 className="text-2xl font-semibold text-white">Monitoramento de IPs</h1>
          </div>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar apelido ou IP"
            className="w-full max-w-sm rounded-lg border border-white/10 bg-slate-950/50 px-4 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
          />
        </div>
        <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={handleCreate}>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Apelido</label>
            <input
              value={form.nickname}
              onChange={(event) => setForm((prev) => ({ ...prev, nickname: event.target.value }))}
              placeholder="Ex: Servidor ERP"
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              required
            />
            <p className="text-xs text-slate-500">Nome amigável para identificar o alvo nos alertas e relatórios.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Endereço IP</label>
            <input
              value={form.ip_address}
              onChange={(event) => setForm((prev) => ({ ...prev, ip_address: event.target.value }))}
              placeholder="Ex: 192.168.0.10"
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              required
            />
            <p className="text-xs text-slate-500">IPv4/IPv6 do destino que será monitorado.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">
              Intervalo de ping (segundos)
            </label>
            <input
              type="number"
              min={60}
              value={form.ping_interval_seconds}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, ping_interval_seconds: Number(event.target.value) }))
              }
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
            <p className="text-xs text-slate-500">
              Frequência das verificações. Mínimo 60s (limite do agendamento via cron em produção).
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Limite</label>
            <input
              type="number"
              min={1}
              value={form.failure_threshold}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, failure_threshold: Number(event.target.value) }))
              }
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
            <p className="text-xs text-slate-500">
              Quantas falhas consecutivas para considerar DOWN (evita falso positivo). Padrão: 2.
            </p>
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Portas</label>
            <input
              value={form.ports}
              onChange={(event) => setForm((prev) => ({ ...prev, ports: event.target.value }))}
              placeholder="Ex: 80,443"
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            />
            <p className="text-xs text-slate-500">
              Portas TCP testadas no alvo (separadas por vírgula). Se ao menos 1 conectar: UP. Padrão: 80,443.
            </p>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="md:col-span-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold uppercase tracking-[0.3em] text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? "Salvando…" : "Adicionar monitor"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Lista de monitores</h2>
          <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Tempo real</span>
        </div>
        <div className="mt-4 space-y-4">
            {filteredMonitors.length ? (
            filteredMonitors.map((monitor) => (
              <div
                key={monitor.id}
                className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1 text-sm text-slate-200">
                  <p className="text-base font-semibold text-white">{monitor.nickname}</p>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{monitor.ip_address}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-300">
                    {monitor.ping_interval_seconds}s
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      monitor.last_status === "DOWN"
                        ? "bg-rose-500/20 text-rose-300"
                        : "bg-emerald-500/20 text-emerald-300"
                    }`}
                  >
                    {monitor.last_status ?? "UP"}
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
                    Details
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">No monitors found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
