/**
 * Layout del grupo (public): landing, pricing, marketing.
 * Cada página dentro maneja su propio backdrop/header. Este layout es un
 * pass-through pensado para futuras decisiones globales (analytics, banner
 * de cookies, etc.).
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
