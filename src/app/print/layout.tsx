// Print layout — no dashboard chrome, neutral background for receipt preview.
// Auth is handled per-page via getActiveMembership().

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-neutral-100 print:bg-white">
      {children}
    </div>
  );
}
