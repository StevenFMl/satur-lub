import { logoutAction } from "@/actions/auth";

export function DashboardHeader({
  businessName,
  userName,
  userEmail,
  role,
}: {
  businessName: string;
  userName: string;
  userEmail: string;
  role?: string;
}) {
  const initials = (userName || userEmail)
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-steel-700 bg-steel-900/80 px-6 backdrop-blur top-highlight">
      <div className="min-w-0">
        <p className="hud-readout">Negocio · activo</p>
        <h1 className="truncate font-display text-[18px] leading-none tracking-[0.04em] text-foreground">
          {businessName}
        </h1>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden min-w-0 text-right sm:block">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {userName}
          </p>
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {role ? `${role} · ` : ""}
            {userEmail}
          </p>
        </div>
        <div
          aria-hidden
          className="grid h-11 w-11 place-items-center rounded-sm border border-steel-700 bg-steel-800 font-mono text-[13px] font-bold text-safety-500 shadow-bevel-sm"
        >
          {initials || "·"}
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-sm border border-steel-700 bg-steel-800 px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-foreground transition-all duration-150 ease-out hover:border-rust-500 hover:text-rust-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-steel-900"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </header>
  );
}
