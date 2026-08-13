import type { CalendarEventSummary } from "@tendnote/domain";
import type { HouseholdCalendarRead } from "@tendnote/domain/household-calendar";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { HouseholdCalendarSurface } from "@/lib/household/household-shared-data";
import { renderInBrowser } from "@/test/browser";
import { HouseholdPlanningSections } from "./household-planning-sections";

const NOW = new Date("2026-08-09T09:00:00Z");
const PROVIDER_TITLE = "School concert and family reception from Google Calendar";

const providerEvent: CalendarEventSummary = {
  providerEventId: "event-1",
  calendarId: "primary",
  title: PROVIDER_TITLE,
  start: new Date("2026-08-11T18:30:00Z"),
  end: new Date("2026-08-11T20:00:00Z"),
  allDay: false,
  status: "confirmed",
  attendees: [],
  location: null,
  description: null,
  updatedAt: null,
};

const calendarRead: HouseholdCalendarRead = {
  families: [
    {
      connectionId: "connection-1",
      label: "Family calendar",
      state: "events",
      stale: false,
      fetchedAt: NOW,
      events: [providerEvent],
    },
  ],
};

const calendars: HouseholdCalendarSurface = {
  connections: [
    {
      id: "connection-1",
      label: "Family calendar",
      calendarId: "primary",
      connectorUserId: "ana",
      designatedByUserId: "ana",
      connectedAt: new Date("2026-08-01T09:00:00Z"),
    },
  ],
  read: calendarRead,
};

let unmount: (() => Promise<void>) | undefined;

afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

describe("Household planning on a phone", () => {
  it("hands a provider event to a blank focused Plan without widening the page", async () => {
    await page.viewport(390, 844);
    const createPlan = vi.fn();
    const rendered = await renderInBrowser(
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-[var(--tn-gutter)] pt-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
          <HouseholdPlanningSections
            calendars={calendars}
            linkCandidates={[]}
            members={[
              { userId: "ana", name: "Ana" },
              { userId: "ben", name: "Ben" },
            ]}
            now={NOW}
            planActions={{ create: createPlan }}
            plans={[]}
            viewerHasCalendarAccess={false}
            viewerRole="member"
            viewerUserId="ben"
          />
        </div>
      </main>,
    );
    unmount = rendered.unmount;

    expect(rendered.container.scrollWidth).toBeLessThanOrEqual(rendered.container.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );

    await act(async () => {
      await userEvent.click(page.getByRole("button", { name: "Plan this event" }));
    });

    const title = page.getByRole("textbox", { name: "What is it" });
    await expect.element(title).toHaveFocus();
    await expect.element(title).toHaveValue("");
    expect(((await title.element()) as HTMLInputElement).value).not.toContain(PROVIDER_TITLE);
    expect(createPlan).not.toHaveBeenCalled();
    expect(rendered.container.scrollWidth).toBeLessThanOrEqual(rendered.container.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });
});
