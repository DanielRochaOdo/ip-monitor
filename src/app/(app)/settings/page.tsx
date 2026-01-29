"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthReady, useSession, useSupabaseClient } from "@/components/supabase-provider";
import { useToast } from "@/components/toast-provider";

type SettingsForm = {
  alert_email: string;
  notify_on_down: boolean;
  notify_on_up: boolean;
};

type AgentRow = {
  id: string;
  name: string;
  site: string;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type NetworkDeviceRow = {
  id: string;
  site: string;
  hostname: string | null;
  vendor: string;
  model: string | null;
  firmware_expected: string | null;
  wan_public_ips: string[];
  lan_ip: string | null;
  agent_id: string | null;
  mgmt_method: "API" | "SNMP" | "TCP_ONLY";
  mgmt_port: number;
  api_base_url: string | null;
  api_token_secret_ref: string | null;
  step_seconds: number | null;
  interface_interval_seconds: number | null;
  status_interval_seconds: number | null;
  backoff_cap_seconds: number | null;
  iface_cooldown_seconds: number | null;
  snmp_version: "v2c" | "v3" | null;
  snmp_target: string | null;
  snmp_community: string | null;
  created_at: string;
  updated_at: string;
  has_token: boolean;
};

type NetworkDeviceForm = {
  id?: string;
  site: string;
  hostname: string;
  lan_ip: string;
  api_base_url: string;
  mgmt_port: string;
  mgmt_method: "API" | "SNMP" | "TCP_ONLY";
  wan_public_ips: string;
  agent_id: string;
  api_token: string;
  api_token_secret_ref: string;
  step_seconds: string;
  interface_interval_seconds: string;
  status_interval_seconds: string;
  backoff_cap_seconds: string;
  iface_cooldown_seconds: string;
};

export default function SettingsPage() {
  const [form, setForm] = useState<SettingsForm>({
    alert_email: "",
    notify_on_down: true,
    notify_on_up: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [newAgentToken, setNewAgentToken] = useState<string | null>(null);
  const [agentForm, setAgentForm] = useState({ name: "", site: "Parangaba" });
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);

  const [devices, setDevices] = useState<NetworkDeviceRow[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [savingDevice, setSavingDevice] = useState(false);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const [deviceForm, setDeviceForm] = useState<NetworkDeviceForm>({
    site: "Parangaba",
    hostname: "",
    lan_ip: "",
    api_base_url: "",
    mgmt_port: "4434",
    mgmt_method: "API",
    wan_public_ips: "",
    agent_id: "",
    api_token: "",
    api_token_secret_ref: "",
    step_seconds: "",
    interface_interval_seconds: "",
    status_interval_seconds: "",
    backoff_cap_seconds: "",
    iface_cooldown_seconds: "",
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

  useEffect(() => {
    if (!authReady || !session?.access_token) return;

    fetch("/api/settings/notifications", { headers: authHeaders })
      .then(async (res) => (await res.json()) as { settings?: SettingsForm } | null)
      .then((data) => {
        if (data?.settings) {
          setForm({
            alert_email: data.settings.alert_email,
            notify_on_down: data.settings.notify_on_down,
            notify_on_up: data.settings.notify_on_up,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [authHeaders, authReady, session?.access_token]);

  const refreshAgents = async () => {
    if (!session?.access_token) return;
    const res = await fetch("/api/agents", { headers: authHeaders });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: unknown }).error ?? "Falha ao carregar agentes")
          : "Falha ao carregar agentes";
      toast.push({ title: "Erro", description: message, variant: "error" });
      return;
    }
    setAgents((payload as AgentRow[] | null) ?? []);
  };

  const refreshDevices = async () => {
    if (!session?.access_token) return;
    setLoadingDevices(true);
    try {
      const res = await fetch("/api/network-devices", { headers: authHeaders });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error ?? "Falha ao carregar devices")
            : "Falha ao carregar devices";
        toast.push({ title: "Erro", description: message, variant: "error" });
        return;
      }
      const devicesPayload =
        payload && typeof payload === "object" && "devices" in payload
          ? ((payload as { devices?: NetworkDeviceRow[] }).devices ?? [])
          : [];
      setDevices(devicesPayload);
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    if (!authReady || !session?.access_token) return;
    void refreshAgents();
    void refreshDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session?.access_token]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/settings/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(form),
    });
    setSaving(false);

    if (!response.ok) {
      const data = (await response.json()) as { error?: string } | null;
      toast.push({ title: "Nao foi possivel salvar", description: data?.error, variant: "error" });
      return;
    }

    toast.push({ title: "Preferencias salvas", variant: "success" });
  };

  const sendTestEmail = async () => {
    setSendingTest(true);
    try {
      const response = await fetch("/api/settings/test-email", {
        method: "POST",
        headers: authHeaders,
      });

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error ?? "Falha ao enviar")
            : "Falha ao enviar";
        toast.push({ title: "Email de teste falhou", description: message, variant: "error" });
        return;
      }

      toast.push({ title: "Email de teste enviado", variant: "success" });
    } finally {
      setSendingTest(false);
    }
  };

  const handleCreateAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.access_token) return;
    setCreatingAgent(true);
    setNewAgentToken(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ name: agentForm.name, site: agentForm.site }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error ?? "Falha ao criar agente")
            : "Falha ao criar agente";
        toast.push({ title: "Erro ao criar agente", description: message, variant: "error" });
        return;
      }

      const token =
        payload &&
        typeof payload === "object" &&
        payload !== null &&
        "token" in payload &&
        typeof (payload as { token?: unknown }).token === "string"
          ? (payload as { token: string }).token
          : null;
      if (token) setNewAgentToken(token);

      toast.push({
        title: "Agente criado",
        description: "Copie o token (aparece uma unica vez).",
        variant: "success",
      });
      setAgentForm({ name: "", site: agentForm.site });
      await refreshAgents();
    } finally {
      setCreatingAgent(false);
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (!session?.access_token) return;
    if (!confirm("Tem certeza que deseja excluir este agente?")) return;
    setDeletingAgentId(agentId);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error ?? "Falha ao excluir agente")
            : "Falha ao excluir agente";
        toast.push({ title: "Erro ao excluir agente", description: message, variant: "error" });
        return;
      }
      toast.push({ title: "Agente excluido", variant: "success" });
      await refreshAgents();
    } finally {
      setDeletingAgentId(null);
    }
  };

  const resetDeviceForm = () => {
    setDeviceForm({
      site: "Parangaba",
      hostname: "",
      lan_ip: "",
      api_base_url: "",
      mgmt_port: "4434",
      mgmt_method: "API",
      wan_public_ips: "",
      agent_id: "",
      api_token: "",
      api_token_secret_ref: "",
      step_seconds: "",
      interface_interval_seconds: "",
      status_interval_seconds: "",
      backoff_cap_seconds: "",
      iface_cooldown_seconds: "",
    });
  };

  const handleSaveDevice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.access_token) return;
    setSavingDevice(true);
    try {
      const payload: Record<string, unknown> = {
        site: deviceForm.site,
        hostname: deviceForm.hostname || null,
        lan_ip: deviceForm.lan_ip || null,
        api_base_url: deviceForm.api_base_url || null,
        mgmt_port: deviceForm.mgmt_port ? Number(deviceForm.mgmt_port) : null,
        mgmt_method: deviceForm.mgmt_method,
        wan_public_ips: deviceForm.wan_public_ips,
        agent_id: deviceForm.agent_id || null,
        api_token_secret_ref: deviceForm.api_token_secret_ref || null,
        step_seconds: deviceForm.step_seconds ? Number(deviceForm.step_seconds) : null,
        interface_interval_seconds: deviceForm.interface_interval_seconds
          ? Number(deviceForm.interface_interval_seconds)
          : null,
        status_interval_seconds: deviceForm.status_interval_seconds ? Number(deviceForm.status_interval_seconds) : null,
        backoff_cap_seconds: deviceForm.backoff_cap_seconds ? Number(deviceForm.backoff_cap_seconds) : null,
        iface_cooldown_seconds: deviceForm.iface_cooldown_seconds ? Number(deviceForm.iface_cooldown_seconds) : null,
      };
      if (deviceForm.api_token.trim()) {
        payload.api_token = deviceForm.api_token.trim();
      }

      const isEditing = !!deviceForm.id;
      const res = await fetch(
        isEditing ? `/api/network-devices/${encodeURIComponent(deviceForm.id!)}` : "/api/network-devices",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(payload),
        },
      );
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error ?? "Falha ao salvar device")
            : "Falha ao salvar device";
        toast.push({ title: "Erro ao salvar device", description: message, variant: "error" });
        return;
      }

      toast.push({ title: isEditing ? "Device atualizado" : "Device criado", variant: "success" });
      resetDeviceForm();
      await refreshDevices();
    } finally {
      setSavingDevice(false);
    }
  };

  const handleEditDevice = (device: NetworkDeviceRow) => {
    setDeviceForm({
      id: device.id,
      site: device.site,
      hostname: device.hostname ?? "",
      lan_ip: device.lan_ip ?? "",
      api_base_url: device.api_base_url ?? "",
      mgmt_port: device.mgmt_port ? String(device.mgmt_port) : "4434",
      mgmt_method: device.mgmt_method,
      wan_public_ips: (device.wan_public_ips ?? []).join(", "),
      agent_id: device.agent_id ?? "",
      api_token: "",
      api_token_secret_ref: device.api_token_secret_ref ?? "",
      step_seconds: device.step_seconds ? String(device.step_seconds) : "",
      interface_interval_seconds: device.interface_interval_seconds ? String(device.interface_interval_seconds) : "",
      status_interval_seconds: device.status_interval_seconds ? String(device.status_interval_seconds) : "",
      backoff_cap_seconds: device.backoff_cap_seconds ? String(device.backoff_cap_seconds) : "",
      iface_cooldown_seconds: device.iface_cooldown_seconds ? String(device.iface_cooldown_seconds) : "",
    });
  };

  const handleDeleteDevice = async (deviceId: string) => {
    if (!session?.access_token) return;
    if (!confirm("Tem certeza que deseja excluir este FortiGate?")) return;
    setDeletingDeviceId(deviceId);
    try {
      const res = await fetch(`/api/network-devices/${encodeURIComponent(deviceId)}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error ?? "Falha ao excluir device")
            : "Falha ao excluir device";
        toast.push({ title: "Erro ao excluir device", description: message, variant: "error" });
        return;
      }
      toast.push({ title: "Device excluido", variant: "success" });
      await refreshDevices();
    } finally {
      setDeletingDeviceId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Configuracoes</p>
        <h1 className="text-2xl font-semibold text-white">Notificacoes</h1>
        <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Emails de alerta</label>
            <input
              type="text"
              value={form.alert_email}
              onChange={(event) => setForm((prev) => ({ ...prev, alert_email: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              disabled={loading}
              placeholder="email1@dominio.com, email2@dominio.com"
            />
            <p className="text-xs text-slate-500">Voce pode informar mais de um email, separado por virgula ou ponto e virgula.</p>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.notify_on_down}
              onChange={(event) => setForm((prev) => ({ ...prev, notify_on_down: event.target.checked }))}
              disabled={loading}
            />
            Notificar quando ficar INDISPONIVEL
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.notify_on_up}
              onChange={(event) => setForm((prev) => ({ ...prev, notify_on_up: event.target.checked }))}
              disabled={loading}
            />
            Notificar quando voltar ONLINE
          </label>
          <button
            type="submit"
            disabled={saving || loading}
            className="md:col-span-2 rounded-full bg-emerald-500 px-5 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Salvar preferencias"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">FortiGate (LAN Agent)</p>
        <p className="text-sm text-slate-300">
          Cadastre manualmente os FortiGates com token real (salvo criptografado no Supabase).
        </p>

        <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={handleSaveDevice}>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Site</label>
            <input
              value={deviceForm.site}
              onChange={(e) => setDeviceForm((p) => ({ ...p, site: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Hostname</label>
            <input
              value={deviceForm.hostname}
              onChange={(e) => setDeviceForm((p) => ({ ...p, hostname: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="FW-ODONTOART-MATRIZ"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Agent</label>
            <select
              value={deviceForm.agent_id}
              onChange={(e) => setDeviceForm((p) => ({ ...p, agent_id: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">(sem agente)</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} - {agent.site}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">LAN IP</label>
            <input
              value={deviceForm.lan_ip}
              onChange={(e) => setDeviceForm((p) => ({ ...p, lan_ip: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="10.85.1.254"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">API Base URL</label>
            <input
              value={deviceForm.api_base_url}
              onChange={(e) => setDeviceForm((p) => ({ ...p, api_base_url: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="https://10.85.1.254:4434"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Porta</label>
            <input
              value={deviceForm.mgmt_port}
              onChange={(e) => setDeviceForm((p) => ({ ...p, mgmt_port: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="4434"
            />
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">WAN IPs (separados por virgula)</label>
            <input
              value={deviceForm.wan_public_ips}
              onChange={(e) => setDeviceForm((p) => ({ ...p, wan_public_ips: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="189.84.127.130, 100.90.122.213"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Metodo</label>
            <select
              value={deviceForm.mgmt_method}
              onChange={(e) => setDeviceForm((p) => ({ ...p, mgmt_method: e.target.value as NetworkDeviceForm["mgmt_method"] }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
            >
              <option value="API">API</option>
              <option value="SNMP">SNMP</option>
              <option value="TCP_ONLY">TCP_ONLY</option>
            </select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Token API (salvo criptografado)</label>
            <input
              type="password"
              value={deviceForm.api_token}
              onChange={(e) => setDeviceForm((p) => ({ ...p, api_token: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder={deviceForm.id ? "Deixe vazio para manter o token atual" : "token do FortiGate"}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Token Ref (opcional)</label>
            <input
              value={deviceForm.api_token_secret_ref}
              onChange={(e) => setDeviceForm((p) => ({ ...p, api_token_secret_ref: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="FGT_MATRIZ_TOKEN"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Step (s)</label>
            <input
              value={deviceForm.step_seconds}
              onChange={(e) => setDeviceForm((p) => ({ ...p, step_seconds: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="600"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Iface interval (s)</label>
            <input
              value={deviceForm.interface_interval_seconds}
              onChange={(e) => setDeviceForm((p) => ({ ...p, interface_interval_seconds: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="3600"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Status interval (s)</label>
            <input
              value={deviceForm.status_interval_seconds}
              onChange={(e) => setDeviceForm((p) => ({ ...p, status_interval_seconds: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Backoff cap (s)</label>
            <input
              value={deviceForm.backoff_cap_seconds}
              onChange={(e) => setDeviceForm((p) => ({ ...p, backoff_cap_seconds: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="3600"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Iface cooldown (s)</label>
            <input
              value={deviceForm.iface_cooldown_seconds}
              onChange={(e) => setDeviceForm((p) => ({ ...p, iface_cooldown_seconds: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              placeholder="3600"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={savingDevice || loadingDevices}
              className="w-full rounded-full border border-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/20 disabled:opacity-60"
            >
              {savingDevice ? "Salvando..." : deviceForm.id ? "Salvar alteracoes" : "Adicionar FortiGate"}
            </button>
          </div>
          {deviceForm.id ? (
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => resetDeviceForm()}
                className="w-full rounded-full border border-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/20"
              >
                Cancelar edicao
              </button>
            </div>
          ) : null}
        </form>

        <div className="mt-4 space-y-2">
          {loadingDevices ? (
            <p className="text-sm text-slate-500">Carregando devices...</p>
          ) : devices.length ? (
            devices.map((device) => (
              <div key={device.id} className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-white">{device.site}</span>
                    <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      {device.hostname || "sem hostname"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleEditDevice(device)}
                      className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-200 hover:border-white/30"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteDevice(device.id)}
                      disabled={deletingDeviceId === device.id}
                      className="rounded-full border border-rose-400/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-rose-200 hover:border-rose-400/80 disabled:opacity-60"
                    >
                      {deletingDeviceId === device.id ? "Excluindo..." : "Excluir"}
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  LAN: {device.lan_ip ?? "--"} | API: {device.api_base_url ?? "--"} | Token:{" "}
                  {device.has_token ? "configurado" : "nao configurado"}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">Nenhum FortiGate cadastrado ainda.</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Teste</p>
            <p className="text-sm text-slate-300">Envie um email de teste para validar o SMTP.</p>
          </div>
          <button
            type="button"
            onClick={() => void sendTestEmail()}
            disabled={sendingTest || loading || !form.alert_email}
            className="rounded-full border border-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/20 disabled:opacity-60"
          >
            {sendingTest ? "Enviando..." : "Enviar email de teste"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Dica: em producao, configure as variaveis SMTP tambem na Vercel (Project Settings &gt; Environment Variables).
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Agentes LAN</p>
        <p className="text-sm text-slate-300">
          O agente roda dentro da sua rede e faz ICMP real + coleta FortiGate (API/SNMP). O token aparece uma unica vez.
        </p>

        <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={handleCreateAgent}>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Nome</label>
            <input
              value={agentForm.name}
              onChange={(e) => setAgentForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Ex: agente-parangaba"
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              disabled={creatingAgent || loading}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Site</label>
            <select
              value={agentForm.site}
              onChange={(e) => setAgentForm((p) => ({ ...p, site: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              disabled={creatingAgent || loading}
            >
              <option>Parangaba</option>
              <option>Bezerra</option>
              <option>Aguanambi</option>
              <option>Matriz</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={creatingAgent || loading || !agentForm.name.trim()}
              className="w-full rounded-full border border-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/20 disabled:opacity-60"
            >
              {creatingAgent ? "Criando..." : "Criar agente"}
            </button>
          </div>
        </form>

        {newAgentToken ? (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="text-sm font-semibold text-emerald-200">Token do agente (copie agora):</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <code className="block break-all rounded-lg bg-slate-950/60 p-3 text-xs text-slate-100">
                {newAgentToken}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(newAgentToken)}
                className="rounded-full border border-emerald-500/40 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200"
              >
                Copiar
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-300">
              Cole em `lan-agent/.env` como `AGENT_TOKEN`. Se voce perder esse token, crie outro agente.
            </p>
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {agents.length ? (
            agents.map((agent) => (
              <div key={agent.id} className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-white">{agent.name}</span>
                    <span className="text-xs uppercase tracking-[0.3em] text-slate-400">{agent.site}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAgent(agent.id)}
                    disabled={deletingAgentId === agent.id}
                    className="rounded-full border border-rose-400/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-rose-200 hover:border-rose-400/80 disabled:opacity-60"
                  >
                    {deletingAgentId === agent.id ? "Excluindo..." : "Excluir"}
                  </button>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  <span>Status: {agent.is_active ? "ativo" : "inativo"}</span>{" "}
                  <span>
                    | Ultimo contato:{" "}
                    {agent.last_seen_at ? new Date(agent.last_seen_at).toLocaleString() : "nunca"}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">Nenhum agente criado ainda.</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <p className="text-sm text-slate-400">
          Os alertas de monitoramento sao enviados via SMTP (configurado no .env). O email acima e o destino dos alertas.
        </p>
      </div>
    </div>
  );
}
