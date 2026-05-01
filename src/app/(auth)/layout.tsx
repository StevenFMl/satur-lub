import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-backdrop relative flex min-h-dvh flex-col">
      <header className="px-6 pt-6 sm:px-10 sm:pt-8">
        <Link
          href="/"
          aria-label="Inicio"
          className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Logo />
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-10 sm:items-center sm:py-16">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>

      <footer className="px-6 pb-6 sm:px-10 sm:pb-8">
        <div className="flex flex-col items-start justify-between gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} SaturnLub</p>
          <nav className="flex items-center gap-5">
            <a href="#" className="hover:text-foreground">
              Términos
            </a>
            <a href="#" className="hover:text-foreground">
              Privacidad
            </a>
            <a href="#" className="hover:text-foreground">
              Soporte
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
