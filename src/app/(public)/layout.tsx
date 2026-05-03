import { PublicNav } from "@/components/public/nav";
import { PublicFooter } from "@/components/public/footer";

/**
 * Layout del grupo (public): landing y futuras páginas de marketing
 * (`/pricing`, `/about`, etc.). Provee chrome compartido — Nav transparente
 * encima del hero y Footer oscuro al cierre — y mantiene el fondo base
 * coherente con la estética industrial de la app.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh w-full flex-col bg-steel-950">
      <PublicNav />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
