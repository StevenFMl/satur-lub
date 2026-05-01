import { logoutAction } from "@/app/(auth)/actions";

export function DashboardHeader({
  businessName,
  userName,
  userEmail,
}: {
  businessName: string;
  userName: string;
  userEmail: string;
}) {
  const initials = (userName || userEmail)
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Negocio
        </p>
        <h1 className="truncate text-sm font-semibold">{businessName}</h1>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium">{userName}</p>
          <p className="text-xs text-muted-foreground">{userEmail}</p>
        </div>
        <div
          aria-hidden
          className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-sm font-semibold text-background"
        >
          {initials || "·"}
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </header>
  );
}
