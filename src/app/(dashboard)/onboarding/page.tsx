import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { getActiveMembership } from "@/lib/supabase/membership";
import { OnboardingForm } from "./onboarding-form";
import { logoutAction } from "@/actions/auth";

export const metadata: Metadata = {
  title: "Configura tu negocio",
};

export default async function OnboardingPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (membership?.tenant_id) redirect("/dashboard");

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "";

  return (
    <div className="garage-backdrop relative flex min-h-dvh flex-col">
      <div aria-hidden className="hazard-stripe h-1 w-full opacity-90" />

      <header className="relative z-10 border-b border-steel-700/80 bg-steel-900/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6 xl:px-8">
          <Link
            href="/"
            aria-label="Inicio"
            className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Logo />
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-sm font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-colors duration-150 hover:text-rust-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 py-10 sm:py-14 lg:py-20 xl:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[300px_1fr] xl:grid-cols-[360px_1fr] lg:gap-14 xl:gap-16">
          
          {/* Columna Izquierda: Header y Stepper */}
          <aside className="space-y-10">
            <div className="space-y-4">
              <span className="hud-readout">Paso 02 · Configura tu negocio</span>
              <h1 className="font-display text-[40px] leading-[0.95] tracking-[0.02em] text-foreground sm:text-[48px] lg:text-[56px]">
                ÚLTIMO AJUSTE
                <br />
                <span className="text-safety-500">ANTES DE OPERAR.</span>
              </h1>
              <p className="text-[14px] leading-7 text-muted-foreground">
                {fullName ? `Hola ${fullName.split(" ")[0]}, ` : ""}
                necesitamos algunos datos para crear tu espacio en SaturnLub.
                Podrás editarlos después desde la configuración.
              </p>
            </div>

            {/* Stepper responsive: horizontal on mobile, vertical on desktop */}
            <ol className="flex flex-wrap items-center gap-3 lg:flex-col lg:items-start lg:gap-5">
              <Step number="01" label="Cuenta" status="done" />
              <StepConnector className="hidden lg:block ml-3.5 h-6 w-px bg-steel-700" />
              <StepConnector className="lg:hidden h-px w-6 bg-steel-700" />
              <Step number="02" label="Negocio" status="active" />
              <StepConnector className="hidden lg:block ml-3.5 h-6 w-px bg-steel-700" />
              <StepConnector className="lg:hidden h-px w-6 bg-steel-700" />
              <Step number="03" label="Listo" status="pending" />
            </ol>
          </aside>

          {/* Columna Derecha: Panel de Formulario */}
          <div className="min-w-0">
            <div className="panel panel-bolts relative overflow-hidden rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_16px_40px_-12px_rgba(0,0,0,0.5)]">
              <span aria-hidden className="bolt-bl" />
              <span aria-hidden className="bolt-br" />

              <header className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-6 py-5 sm:px-8">
                <h2 className="font-display text-[20px] leading-none tracking-[0.04em] text-foreground sm:text-[24px]">
                  FICHA TÉCNICA DEL NEGOCIO
                </h2>
                <span className="hud-readout hidden sm:inline-block">Configuración · v1</span>
              </header>

              <div className="px-6 py-8 sm:px-8 sm:py-10">
                <OnboardingForm />
              </div>
            </div>
          </div>

        </div>
      </main>

      <footer className="relative z-10 border-t border-steel-700/80 bg-steel-900/50">
        <div className="mx-auto w-full max-w-7xl px-6 py-4 xl:px-8">
          <p className="industrial-label !text-[10px]">
            © {new Date().getFullYear()} SATURNLUB · SISTEMA OPERATIVO INDUSTRIAL
          </p>
        </div>
      </footer>
    </div>
  );
}

function Step({
  number,
  label,
  status,
}: {
  number: string;
  label: string;
  status: "done" | "active" | "pending";
}) {
  const styles =
    status === "done"
      ? "bg-safety-500 text-steel-950 border-black/40"
      : status === "active"
        ? "bg-steel-900 text-safety-500 border-safety-500 shadow-[0_0_12px_-2px_rgba(255,193,7,0.3)]"
        : "bg-steel-900 text-muted-foreground border-steel-700";

  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden
        className={`grid h-7 w-7 place-items-center border font-mono text-[10px] font-bold tracking-wider rounded-sm transition-colors duration-200 ${styles}`}
      >
        {status === "done" ? "✓" : number}
      </span>
      <span
        className={`font-mono text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors duration-200 ${
          status === "pending" ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {label}
      </span>
    </li>
  );
}

function StepConnector({ className }: { className?: string }) {
  return <li aria-hidden className={className} />;
}
