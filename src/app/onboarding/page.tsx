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
    <div className="auth-backdrop relative flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
        <Link
          href="/"
          aria-label="Inicio"
          className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Logo />
        </Link>
        <form action={logoutAction}>
          <button
            type="submit"
            className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Cerrar sesión
          </button>
        </form>
      </header>

      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-6 py-10 sm:py-14">
        <ol className="mb-6 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <li className="flex items-center gap-2">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-foreground text-[10px] font-semibold text-background">
              ✓
            </span>
            Cuenta
          </li>
          <li aria-hidden className="h-px w-6 bg-border" />
          <li className="flex items-center gap-2 text-foreground">
            <span className="grid h-4 w-4 place-items-center rounded-full border border-foreground text-[10px] font-semibold">
              2
            </span>
            Negocio
          </li>
        </ol>

        <div className="mb-8 space-y-2">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
            Configura tu negocio
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {fullName ? `Hola ${fullName}, último paso. ` : ""}
            Necesitamos algunos datos para crear tu espacio en SaturnLub.
            Podrás editarlos después desde la configuración.
          </p>
        </div>

        <OnboardingForm />
      </main>

      <footer className="px-6 pb-6 sm:px-10 sm:pb-8">
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} SaturnLub
        </p>
      </footer>
    </div>
  );
}
