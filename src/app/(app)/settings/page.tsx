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

export default function SettingsPage() {
  const [form, setForm] = useState<SettingsForm>({
    alert_email: "",
    notify_on_down: true,
    notify_on_up: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
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
      toast.push({ title: "Unable to save", description: data?.error, variant: "error" });
      return;
    }

    toast.push({ title: "Settings saved", variant: "success" });
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

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Configurações</p>
        <h1 className="text-2xl font-semibold text-white">Notificações</h1>
        <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <div className="space-y-1 md:col-span-2">
          <label className="text-xs uppercase tracking-[0.4em] text-slate-400">Email de alerta</label>
            <input
              type="email"
              value={form.alert_email}
              onChange={(event) => setForm((prev) => ({ ...prev, alert_email: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
              disabled={loading}
            />
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.notify_on_down}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, notify_on_down: event.target.checked }))
              }
              disabled={loading}
            />
            Notificar quando ficar INDISPONÍVEL
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.notify_on_up}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, notify_on_up: event.target.checked }))
              }
              disabled={loading}
            />
            Notificar quando voltar ONLINE
          </label>
          <button
            type="submit"
            disabled={saving || loading}
            className="md:col-span-2 rounded-full bg-emerald-500 px-5 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Salvar preferências"}
          </button>
        </form>
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
            {sendingTest ? "Enviando…" : "Enviar email de teste"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Dica: em producao, configure as variaveis SMTP tambem na Vercel (Project Settings &gt; Environment Variables).
        </p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <p className="text-sm text-slate-400">
          Os alertas de monitoramento são enviados via SMTP (configurado no .env). O email acima é o destino dos alertas.
        </p>
      </div>
    </div>
  );
}
