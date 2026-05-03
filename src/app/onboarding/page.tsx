import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";
import { logoutAction } from "../(auth)/actions";

export const metadata: Metadata = {
  title: "Configura tu negocio",
};

export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing } = await supabase
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (existing?.tenant_id) redirect("/dashboard");

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "";

  return (
    <div className="garage-backdrop relative flex min-h-dvh flex-col">
      <div aria-hidden className="hazard-stripe h-1 w-full opacity-90" />

      <header className="relative z-10 border-b border-steel-700/80 bg-steel-900/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-6">
          <Link
            href="/"
            aria-label="Inicio"
            className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500"
          >
            <Logo />
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10 sm:py-14">
        {/* Stepper industrial */}
        <ol className="mb-8 flex items-center gap-3">
          <Step number="01" label="Cuenta" status="done" />
          <StepConnector />
          <Step number="02" label="Negocio" status="active" />
          <StepConnector />
          <Step number="03" label="Listo" status="pending" />
        </ol>

        {/* Hero del paso */}
        <div className="mb-8 space-y-3">
          <span className="hud-readout">Paso 02 · Configura tu negocio</span>
          <h1 className="font-display text-[40px] leading-[0.95] tracking-[0.02em] text-foreground sm:text-[48px]">
            ÚLTIMO AJUSTE
            <br />
            <span className="text-safety-500">ANTES DE OPERAR.</span>
          </h1>
          <p className="max-w-xl text-[14px] leading-7 text-muted-foreground">
            {fullName ? `Hola ${fullName.split(" ")[0]}, ` : ""}
            necesitamos algunos datos para crear tu espacio en SaturnLub.
            Podrás editarlos después desde la configuración.
          </p>
        </div>

        {/* Panel con el formulario */}
        <div className="panel panel-bolts relative overflow-hidden rounded-sm">
          <span aria-hidden className="bolt-bl" />
          <span aria-hidden className="bolt-br" />

          <header className="top-highlight flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-6 py-4">
            <h2 className="font-display text-[18px] leading-none tracking-[0.04em] text-foreground">
              FICHA TÉCNICA DEL NEGOCIO
            </h2>
            <span className="hud-readout">Setup · v1</span>
          </header>

          <div className="px-6 py-7 sm:px-7">
            <OnboardingForm />
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-steel-700/80 bg-steel-900/50">
        <div className="mx-auto w-full max-w-3xl px-6 py-3">
          <p className="industrial-label !text-[10px]">
            © {new Date().getFullYear()} SATURNLUB · HEAVY-DUTY OS
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
        ? "bg-steel-900 text-safety-500 border-safety-500"
        : "bg-steel-900 text-muted-foreground border-steel-700";

  return (
    <li className="flex items-center gap-2.5">
      <span
        aria-hidden
        className={`grid h-7 w-7 place-items-center border font-mono text-[10px] font-bold tracking-wider rounded-sm ${styles}`}
      >
        {status === "done" ? "✓" : number}
      </span>
      <span
        className={`font-mono text-[11px] font-semibold uppercase tracking-[0.16em] ${
          status === "pending" ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {label}
      </span>
    </li>
  );
}

function StepConnector() {
  return <li aria-hidden className="h-px w-8 bg-steel-700" />;
}
