// Screen shown when the print page hits a DB/schema error (not a 404).
// Distinct from notFound() so the user sees a useful message instead of
// a blank 404 page when the sale exists but the query failed.

export function PrintError({
  saleId,
  code,
  message,
}: {
  saleId:  string;
  code:    string | undefined;
  message: string | undefined;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-md rounded border border-red-300 bg-white p-6 shadow-sm">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-red-500">
          Error al cargar comprobante
        </p>
        <p className="mt-2 text-[13px] text-neutral-700">
          No se pudo generar la impresión de la venta{" "}
          <span className="font-mono font-bold">#{saleId.slice(0, 8).toUpperCase()}</span>.
        </p>
        {code && (
          <p className="mt-3 font-mono text-[11px] text-neutral-500">
            Código: <span className="text-red-600">{code}</span>
          </p>
        )}
        {message && (
          <p className="font-mono text-[11px] text-neutral-500 break-words">
            Detalle: {message}
          </p>
        )}
        <p className="mt-4 font-mono text-[10px] text-neutral-400">
          Revisa los server logs para el diagnóstico completo.
        </p>
        <a
          href={`/dashboard/pos/ventas/${saleId}`}
          className="mt-4 inline-block rounded border border-neutral-300 bg-neutral-50 px-4 py-2 font-mono text-[11px] text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
        >
          ← Volver a la venta
        </a>
      </div>
    </div>
  );
}
