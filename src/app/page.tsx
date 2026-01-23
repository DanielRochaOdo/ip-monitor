import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-slate-950 text-white">
      <div className="max-w-4xl text-center">
        <p className="text-sm uppercase tracking-[0.4em] text-emerald-300">Monitoramento de rede</p>
        <h1 className="mt-4 text-4xl font-bold sm:text-5xl">Mantenha seus IPs críticos online</h1>
        <p className="mt-4 text-lg text-slate-300">
          Cadastre IPs, agende verificações inteligentes e receba alertas elegantes quando houver incidentes.
        </p>
      </div>
      <div className="flex gap-4">
        <Link
          href="/signup"
          className="rounded-full bg-emerald-500 px-8 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-950 transition hover:bg-emerald-400"
        >
          Criar conta
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-white/30 px-8 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white"
        >
          Entrar
        </Link>
      </div>
    </div>
  );
}
