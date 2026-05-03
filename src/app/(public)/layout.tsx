import { PublicNav } from "@/components/public/nav";
import { PublicFooter } from "@/components/public/footer";

/**
 * Layout del grupo (public): landing y futuras páginas de marketing
 * (`/pricing`, `/about`, etc.). Provee chrome compartido — Nav sticky con
 * fondo dinámico al scroll y Footer oscuro al cierre — y mantiene el fondo
 * base coherente con la estética industrial de la app.
 *
 * El Nav vive dentro del `<body>` (no fixed) y depende de `sticky top-0` para
 * mantenerse visible al scrollear. Cada página del grupo decide si quiere
 * compensar el alto del nav o dejar que el contenido fluya por debajo
 * (el Hero usa `-mt-20` para que el nav arranque transparente sobre él).
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh w-full flex-col bg-zinc-950 text-foreground">
      <PublicNav />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
