import type { ReactNode } from "react";

/**
 * The dashboard's canvas: the greeting above, the assistant column beside the
 * tabbed context rail. It holds no owner data and reads no request state, so it
 * belongs to the destination's static shell — every region below streams into
 * geometry that is already on screen, and the Today and Review tabs share one
 * canvas rather than teleporting between two layouts.
 *
 * On desktop the dashboard fills the viewport and does not scroll itself
 * (100dvh − 3.5rem header − 4rem main padding); the assistant and the rail each
 * scroll inside their own column instead of growing the page. `grid-rows
 * minmax(0,1fr)` makes the single row fill that bounded height; without it the
 * row is auto-sized to content and the assistant column grows past the viewport
 * instead of scrolling inside itself. The rail widens a touch from lg→xl so its
 * tabs and cards keep room.
 */
export function DashboardFrame({
  assistant,
  greeting,
  rail,
}: {
  assistant: ReactNode;
  greeting: ReactNode;
  rail: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 lg:h-[calc(100dvh-7.5rem)] lg:gap-8 lg:overflow-hidden">
      {greeting}
      <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[minmax(0,1fr)] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="order-1 h-[70dvh] lg:h-full lg:min-h-0">{assistant}</div>
        {/* The rail manages its own scroll inside the active tab panel (the tab
            bar stays pinned), so the column itself is only height-bounded. */}
        <div className="order-2 lg:h-full lg:min-h-0">{rail}</div>
      </div>
    </div>
  );
}
