import { type AppDestinationId, appDestination } from "@/components/app-destinations";
import { cn } from "@/lib/utils";

/** A truthful destination scaffold while its owner-scoped regions stream. */
export function RouteReserve({ destination: id }: { destination: AppDestinationId }) {
  const destination = appDestination(id);
  return (
    <div
      aria-busy="true"
      className={cn(
        "mx-auto flex w-full flex-col gap-6",
        destination.reserve.shape === "detail" ? "max-w-3xl" : "max-w-2xl",
      )}
      data-reserve-shape={destination.reserve.shape}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)]">
          {destination.reserve.heading}
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
