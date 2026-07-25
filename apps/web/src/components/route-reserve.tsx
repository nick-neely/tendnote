/** A truthful destination scaffold while its owner-scoped regions stream. */
export function RouteReserve({ title }: { title: string }) {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)]">
          {title}
        </h1>
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      </header>
      <div className="grid gap-3">
        <div className="h-24 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-24 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-24 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    </div>
  );
}
