"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { appDestination, homePanelForLocation } from "@/components/app-destinations";

/**
 * The narrow-viewport Home reserve. Home owns its own mobile canvas (the shell
 * stops padding it — see `data-mobile-bleed` in globals.css), so the reserve owns
 * the destination's full shape: the Today orientation band with its composer
 * well, or the padded Review list.
 *
 * The destination name comes from the client URL, which is only available after
 * the navigation commits — hence the inner boundary, whose own fallback holds the
 * shared geometry without claiming a name it does not yet know.
 */
export function MobileHomeReserve() {
  return (
    <Suspense fallback={<TodayBandReserve />}>
      <ResolvedMobileHomeReserve />
    </Suspense>
  );
}

function ResolvedMobileHomeReserve() {
  const searchParams = useSearchParams();
  return homePanelForLocation("/", searchParams) === "review" ? (
    <ReviewListReserve />
  ) : (
    <TodayBandReserve title={appDestination("today").label} />
  );
}

const BAND_TITLE = "font-semibold text-[length:var(--text-h1)] leading-[var(--text-h1-line)]";

/** Shaped like `TodayEveComposer` plus the first rows of the Today shortlist. */
function TodayBandReserve({ title }: { title?: string }) {
  return (
    <section
      aria-busy="true"
      aria-label={`Loading ${title ?? "Home"}`}
      // The shell stops padding Home's `<main>` on narrow viewports, so the reserve
      // owns the clearance the fixed bottom bar needs, exactly as the resolved
      // destination does.
      className="min-h-dvh pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
    >
      <div className="bg-panel px-5 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-6">
        {/* Before the client URL resolves there is no destination name to claim, and a
            heading with no accessible name is worse than none — so the placeholder is
            not a heading. Same type styles, same line box. */}
        {title ? (
          <h1 className={BAND_TITLE}>{title}</h1>
        ) : (
          <div aria-hidden className={BAND_TITLE}>
            <span className="inline-block h-[1em] w-[5ch] rounded bg-muted" />
          </div>
        )}
        <p aria-hidden className="mt-0.5 text-muted-foreground text-sm">
          <span className="inline-block h-[1em] w-[13ch] rounded bg-muted" />
        </p>
        <div aria-hidden className="mt-6 min-h-28 w-full rounded-xl border bg-background" />
      </div>
      <div className="flex flex-col gap-3 px-5 pt-6">
        <RowReserve />
        <RowReserve />
      </div>
    </section>
  );
}

function ReviewListReserve() {
  return (
    <section
      aria-busy="true"
      aria-label={`Loading ${appDestination("review").label}`}
      className="flex flex-col gap-6 px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6"
    >
      <header className="flex flex-col gap-2">
        <h1 className="font-semibold text-[length:var(--text-h1)] leading-[var(--text-h1-line)]">
          {appDestination("review").label}
        </h1>
        <p className="text-muted-foreground text-sm">Suggestions appear here as they are ready.</p>
      </header>
      <RowReserve />
      <RowReserve />
    </section>
  );
}

function RowReserve() {
  return <div aria-hidden className="h-24 animate-pulse rounded-xl border bg-muted/40" />;
}
