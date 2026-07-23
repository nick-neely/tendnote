import { CalendarDotsIcon, HistoryIcon, UsersRoundIcon } from "@/components/icons";
import type { CalendarPreviewView } from "@/lib/integrations/calendar-preview";

/**
 * A calm, read-only glance at the owner's connected Google Calendar (Phase 2C,
 * issue #110). This is provider-derived context — NOT approved memory and NOT an
 * active follow-up — so it carries no accept/dismiss/edit affordances and uses
 * neutral treatment (no sage/clay). Times and the source label are machine facts in
 * mono. When only an expired cache is available the data is clearly marked stale.
 * Renders nothing unless the calendar is connected.
 */
export function CalendarPreviewSection({ view }: { view: CalendarPreviewView }) {
  if (view.state === "hidden") {
    return null;
  }

  return (
    <section
      aria-label="Calendar preview"
      className="scroll-mt-20 flex flex-col gap-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      id="calendar-preview"
      tabIndex={-1}
    >
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground">
          <CalendarDotsIcon aria-hidden className="size-4 shrink-0" />
          On your calendar
          <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] font-normal">
            <span className="font-mono">Google&nbsp;Calendar</span> · read-only
          </span>
        </h3>
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          Read-only context from your calendar. Tendnote never saves these as memory or follow-ups.
        </p>
      </div>

      {view.state === "unavailable" ? (
        <p className="rounded-lg border border-dashed bg-surface px-3.5 py-3 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          Couldn&rsquo;t reach Google Calendar just now. Eve and your briefs still work, and this
          will refresh on its own.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {view.stale ? (
            <p className="flex items-center gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
              <HistoryIcon aria-hidden className="size-3.5 shrink-0" />
              <span>
                Showing cached events from <span className="font-mono">{view.cachedLabel}</span>.
                These may be out of date.
              </span>
            </p>
          ) : null}

          {view.state === "empty" ? (
            <p className="rounded-lg border bg-surface px-3.5 py-3 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              Nothing scheduled in the next several days.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border bg-surface">
              {view.events.map((event) => (
                <li
                  className="scroll-mt-20 flex items-baseline gap-3 px-3.5 py-2.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  id={`calendar-event-${encodeURIComponent(event.id)}`}
                  key={event.id}
                  tabIndex={-1}
                >
                  <span className="w-24 shrink-0 truncate font-mono text-[length:var(--text-caption)] leading-[var(--text-body-line)] text-muted-foreground">
                    {event.whenLabel}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[length:var(--text-body)] leading-[var(--text-body-line)]">
                      {event.title}
                    </span>
                    {event.withWhom ? (
                      <span className="flex items-center gap-1 truncate text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
                        <UsersRoundIcon aria-hidden className="size-3 shrink-0" />
                        {event.withWhom}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
