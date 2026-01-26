"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthReady, useSession, useSupabaseClient } from "@/components/supabase-provider";
import { useToast } from "@/components/toast-provider";
import { useEffect } from "react";

export default function LoginPage() {
  const supabase = useSupabaseClient();
  const router = useRouter();
  const toast = useToast();
  const session = useSession();
  const authReady = useAuthReady();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authReady) return;
    if (session?.access_token) {
      router.replace("/dashboard");
    }
  }, [authReady, router, session?.access_token]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      toast.push({ title: "Login failed", description: error.message, variant: "error" });
      return;
    }

    toast.push({ title: "Welcome back!", variant: "success" });
    // If the SDK already returned a session, navigate immediately; otherwise retry once.
    if (!data?.session) {
      await supabase.auth.getSession();
    }
    router.replace("/dashboard");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-10 shadow-2xl backdrop-blur">
          <h1 className="text-3xl font-semibold">Entrar</h1>
          <p className="mt-2 text-sm text-slate-400">Monitore seus IPs com segurança e receba alertas.</p>
          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-slate-300" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-white/20 bg-slate-950/50 px-4 py-3 text-sm placeholder:text-slate-500"
            />
            <label className="block text-sm font-medium text-slate-300" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-white/20 bg-slate-950/50 px-4 py-3 text-sm placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Entrando…" : "Entrar"}
            </button>
          </form>
          <div className="mt-6 flex justify-between text-sm text-slate-400">
            <Link href="/reset-password" className="hover:text-white">
              Esqueceu a senha?
            </Link>
            <Link href="/signup" className="hover:text-white">
              Criar conta
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
