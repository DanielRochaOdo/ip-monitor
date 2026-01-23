"use client";

import { type ReactNode, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "@/components/toast-provider";
import { useAuthReady, useSupabaseClient, useSession } from "@/components/supabase-provider";
import { Database } from "@/lib/supabase/types";
import { Home, Server, PieChart, Settings, LogOut } from "lucide-react";
import { runChecksAction } from "@/actions/runChecksAction";

  const navItems = [
    { label: "Painel", href: "/dashboard", icon: Home },
    { label: "Monitores", href: "/monitors", icon: Server },
    { label: "Relatórios", href: "/reports", icon: PieChart },
    { label: "Configurações", href: "/settings", icon: Settings },
  ];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const toast = useToast();
  const supabase = useSupabaseClient<Database>();
  const session = useSession();
  const authReady = useAuthReady();
  const router = useRouter();
  const cronRunningRef = useRef(false);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.push({ title: "Signed out", variant: "default" });
    router.push("/login");
  };

  // Dev-only: emulate cron while the app is open in the browser.
  // For production, rely on Vercel Cron (vercel.json).
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!authReady || !session?.access_token) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || cronRunningRef.current) return;
      cronRunningRef.current = true;
      try {
        const result = await runChecksAction();
        if (result.errors?.length) {
          toast.push({
            title: "Cron (dev) com erro",
            description: result.errors[0],
            variant: "error",
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao executar verificacoes";
        toast.push({ title: "Cron (dev) falhou", description: message, variant: "error" });
      } finally {
        cronRunningRef.current = false;
      }
    };

    // Run immediately once, then every 60s (min supported).
    void tick();
    const interval = setInterval(() => void tick(), 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authReady, session?.access_token, toast]);

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 border-r border-slate-800 bg-slate-950/80 px-4 py-6">
        <div className="mb-10 text-lg font-semibold tracking-wide text-white">IP Monitor</div>
        <nav className="space-y-2">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-white/10 text-white shadow-inner shadow-black"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex-1 flex flex-col bg-slate-950/60 border-l border-slate-900">
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="text-sm uppercase tracking-[0.2em] text-slate-400">Monitoramento de rede</div>
          <div className="flex items-center gap-4">
            {session?.user.email && (
              <span className="text-sm text-slate-300">{session.user.email}</span>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-full border border-slate-700 px-4 py-1 text-xs uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
            >
              <LogOut className="h-3 w-3" />
              Sair
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-6 py-10">{children}</main>
      </div>
    </div>
  );
}
