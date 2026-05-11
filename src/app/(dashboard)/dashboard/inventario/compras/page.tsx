import { redirect } from "next/navigation";

// Compras se movió a /dashboard/compras como módulo de operación principal.
// Mantenemos este redirect para que bookmarks viejos sigan funcionando.
export default function RedirectToCompras() {
  redirect("/dashboard/compras");
}
