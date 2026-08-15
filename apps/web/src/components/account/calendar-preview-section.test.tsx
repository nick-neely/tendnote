import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CalendarPreviewView } from "@/lib/integrations/calendar-preview";
import { CalendarPreviewSection } from "./calendar-preview-section";

function render(view: CalendarPreviewView) {
  return renderToStaticMarkup(<CalendarPreviewSection view={view} />);
}

describe("CalendarPreviewSection", () => {
  it("renders nothing when the calendar is not connected", () => {
    expect(render({ state: "hidden" })).toBe("");
  });

  it("frames events as read-only provider context with no accept/dismiss controls", () => {
    const html = render({
      state: "events",
      stale: false,
      cachedLabel: null,
      events: [
        { id: "e1", title: "Coffee with Maya", whenLabel: "Tue 3:30 PM", withWhom: "with Maya" },
      ],
    });

    expect(html).toContain("read-only");
    expect(html).toContain("never saves these as memory or follow-ups");
    expect(html).toContain("Coffee with Maya");
    expect(html).toContain("Tue 3:30 PM");
    expect(html).toContain('id="calendar-event-e1"');
    expect(html).toContain('tabindex="-1"');
    // Read-only: no review-style actions.
    expect(html).not.toContain("Accept");
    expect(html).not.toContain("Dismiss");
    expect(html).not.toContain("<button");
  });

  it("marks stale cache clearly when shown beyond freshness", () => {
    const html = render({
      state: "events",
      stale: true,
      cachedLabel: "2h ago",
      events: [{ id: "e1", title: "Standup", whenLabel: "Wed 9:00 AM", withWhom: null }],
    });

    expect(html).toContain("cached events");
    expect(html).toContain("2h ago");
    expect(html).toContain("out of date");
  });

  it("shows a calm empty state with no guilt framing", () => {
    const html = render({ state: "empty", stale: false, cachedLabel: null });
    expect(html).toContain("Nothing scheduled");
  });

  it("degrades gracefully when the provider is unavailable", () => {
    const html = render({ state: "unavailable" });
    expect(html).toContain("Couldn");
    expect(html).toContain("briefs still work");
  });

  it("explains when the provider must be reconnected", () => {
    const html = render({ state: "needs_reconnect" });
    expect(html).toContain("needs to be reconnected");
    expect(html).toContain("Use Connect in Integrations");
  });
});
