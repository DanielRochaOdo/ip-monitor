"use client";

import { createBrowserClient } from "@supabase/auth-helpers-nextjs";
import { type Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Database } from "@/types/database.types";

type SupabaseContextValue = {
  supabase: ReturnType<typeof createBrowserClient> | null;
  session: Session | null;
  isReady: boolean;
};

const SupabaseContext = createContext<SupabaseContextValue | undefined>(undefined);

export type SupabaseProviderProps = {
  initialSession?: Session | null;
  children: ReactNode;
};

export function SupabaseProvider({ children, initialSession = null }: SupabaseProviderProps) {
  const supabaseClient = useMemo(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn("Supabase env vars missing, client will not be initialized");
      return null;
    }

    return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  }, []);

  const [session, setSession] = useState<Session | null>(initialSession);
  const [isReady, setIsReady] = useState<boolean>(initialSession !== null);

  useEffect(() => {
    if (!supabaseClient) {
      return;
    }

    let mounted = true;

    const bootstrapSession = async () => {
      try {
        const { data } = await supabaseClient.auth.getSession();
        if (mounted) {
          setSession(data?.session ?? null);
        }
      } finally {
        if (mounted) {
          setIsReady(true);
        }
      }
    };

    bootstrapSession();

    const { data: listener } = supabaseClient.auth.onAuthStateChange((_, newSession) => {
      setSession(newSession);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabaseClient]);

  const contextValue = useMemo(
    () => ({ supabase: supabaseClient, session, isReady }),
    [isReady, session, supabaseClient],
  );

  if (!supabaseClient) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="w-full max-w-lg rounded-2xl border border-rose-500/40 bg-slate-900/60 p-6 text-center text-sm">
          Falta configurar as variáveis <code>NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
        </div>
      </div>
    );
  }

  return <SupabaseContext.Provider value={contextValue}>{children}</SupabaseContext.Provider>;
}

export function useSupabaseClient() {
  const context = useContext(SupabaseContext);
  if (!context) {
    throw new Error("SupabaseProvider is missing");
  }
  if (!context.supabase) {
    throw new Error("Supabase client is not initialized");
  }
  return context.supabase;
}

export function useSession() {
  const context = useContext(SupabaseContext);
  if (!context) {
    throw new Error("SupabaseProvider is missing");
  }
  return context.session;
}

export function useAuthReady() {
  const context = useContext(SupabaseContext);
  if (!context) {
    throw new Error("SupabaseProvider is missing");
  }
  return context.isReady;
}
