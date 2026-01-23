import "./globals.css";
import type { ReactNode } from "react";
import { SupabaseProvider } from "@/components/supabase-provider";
import { ToastProvider } from "@/components/toast-provider";

export const metadata = {
  title: "IP Monitor",
  description: "Monitor IP availability and receive alerts when targets go down.",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <SupabaseProvider>
          <ToastProvider>{children}</ToastProvider>
        </SupabaseProvider>
      </body>
    </html>
  );
}
