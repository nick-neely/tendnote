import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CalendarAttendee, CalendarEventSummary } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import type { CalendarReadRequest } from "./calendar";
import { createInMemoryCalendarSuggestionStore } from "./calendar-followups/in-memory-store";
import { createCalendarSuggestionReview } from "./calendar-followups/suggestions";
import { createCalendarSuggestionWorkflow } from "./calendar-followups/workflow";
import {
  createPostMeetingAftercareWorkflow,
  type GeneratePostMeetingAftercareInput,
} from "./post-meeting-aftercare";
import {
  createInMemoryScheduledWorkflowDeliveryStore,
  createScheduledWorkflowDeliveryService,
} from "./scheduled-workflow-deliveries";

const OWNER = "owner-1";
const NOW = new Date("2026-07-02T18:00:00.000Z");

function attendee(overrides: Partial<CalendarAttendee> = {}): CalendarAttendee {
  return {
    email: overrides.email ?? null,
    displayName: overrides.displayName ?? null,
    responseStatus: null,
    self: overrides.self ?? false,
    organizer: overrides.organizer ?? false,
  };
}

function event(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    providerEventId: overrides.providerEventId ?? "evt-1",
    calendarId: overrides.calendarId ?? "primary",
    title: overrides.title ?? "Project debrief",
    start: overrides.start ?? new Date("2026-07-02T16:00:00.000Z"),
    end: overrides.end ?? new Date("2026-07-02T17:00:00.000Z"),
    allDay: overrides.allDay ?? false,
    status: overrides.status ?? "confirmed",
    attendees: overrides.attendees ?? [
      attendee({ email: "me@tendnote.test", self: true }),
      attendee({ email: "maya@tendnote.test", displayName: "Maya Chen" }),
    ],
    location: null,
    description: null,
    updatedAt: null,
  };
}

function setupWorkflow(
  input: { events?: CalendarEventSummary[]; connected?: boolean; deliverDiscord?: boolean } = {},
) {
  const store = createInMemoryCalendarSuggestionStore();
  const review = createCalendarSuggestionReview(store);
  const read = vi.fn(async (_request: CalendarReadRequest) => ({
    connected: input.connected ?? true,
    result:
      input.connected === false
        ? null
        : {
            events: input.events ?? [event()],
            source: "live" as const,
            stale: false,
            fetchedAt: NOW,
            expiresAt: new Date(NOW.getTime() + 60_000),
          },
  }));
  const calendarWorkflow = createCalendarSuggestionWorkflow({
    readerFor: vi.fn(() => ({
      readCalendarEvents: vi.fn(async () => ({
        events: [],
        source: "live" as const,
        stale: false,
        fetchedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 60_000),
      })),
    })),
    review,
    matcher: {
      findPeopleByEmail: vi.fn(async (_ownerUserId, email) =>
        email === "maya@tendnote.test" ? [{ id: "person-1", displayName: "Maya Chen" }] : [],
      ),
      findPeopleByName: vi.fn(async () => []),
    },
    read,
  });
  const delivery = createScheduledWorkflowDeliveryService(
    createInMemoryScheduledWorkflowDeliveryStore(),
  );
  const workflow = createPostMeetingAftercareWorkflow({
    runCalendarSuggestionWorkflow: (args) => calendarWorkflow.runCalendarSuggestionWorkflow(args),
    listCalendarSuggestedFollowups: (ownerUserId) => review.listSuggestedFollowups(ownerUserId),
    deliverDiscordScheduledArtifact: input.deliverDiscord
      ? (args) => delivery.deliverDiscordScheduledArtifact(args)
      : undefined,
  });

  return { store, review, read, workflow, delivery };
}

async function run(
  workflow: ReturnType<typeof createPostMeetingAftercareWorkflow>,
  input: Partial<GeneratePostMeetingAftercareInput> = {},
) {
  return workflow.generatePostMeetingAftercare({
    ownerUserId: OWNER,
    now: NOW,
    ...input,
  });
}

describe("Post-Meeting Aftercare workflow", () => {
  it("reads eligible recent meetings through the owner-scoped Calendar boundary", async () => {
    const { read, workflow } = setupWorkflow();

    const result = await run(workflow);

    expect(result.connected).toBe(true);
    expect(result.generated).toBe(1);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: OWNER,
        providerKey: "google",
        capabilityKey: "calendar",
        calendarId: "primary",
        query: null,
      }),
      expect.objectContaining({ reader: expect.any(Object) }),
    );
    const request = read.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    if (!request) {
      throw new Error("Expected Calendar read request.");
    }
    expect(request.timeMin.getTime()).toBeLessThan(NOW.getTime());
    expect(request.timeMax.getTime()).toBeGreaterThan(NOW.getTime());
    expect(request.maxResults).toBeLessThanOrEqual(25);
  });

  it("persists reviewable owner-scoped aftercare proposals without promoting them", async () => {
    const { review, workflow } = setupWorkflow();

    const result = await run(workflow);

    expect(result.suggestedFollowups).toHaveLength(1);
    expect(result.memoryReviewPrompts).toEqual([]);
    expect(result.draftProposals).toEqual([]);
    expect(result.suggestedFollowups[0]).toMatchObject({
      ownerUserId: OWNER,
      status: "suggested",
      personId: "person-1",
      personDisplayName: "Maya Chen",
      shape: "post_meeting_followup",
    });
    expect(result.artifact).toMatchObject({
      ownerUserId: OWNER,
      workflow: "post_meeting_aftercare",
      artifactKind: "post_meeting_aftercare",
      artifactId: `calendar-suggested-followups:${result.suggestedFollowups[0]?.id}`,
      sensitivity: "normal",
      persisted: true,
      summary: "One post-meeting aftercare proposal is ready.",
      // Calendar-derived aftercare is drawn from the owner's private calendar, so
      // the artifact fails closed to private (ADR-0142).
      scope: "private",
      householdId: null,
    });
    await expect(review.listSuggestedFollowups(OWNER)).resolves.toEqual(result.suggestedFollowups);
  });

  it("degrades to no artifact when Calendar is unavailable", async () => {
    const { workflow } = setupWorkflow({ connected: false });

    const result = await run(workflow);

    expect(result).toMatchObject({
      connected: false,
      generated: 0,
      suggestedFollowups: [],
      artifact: null,
      delivery: null,
    });
  });

  it("degrades to no artifact when the Calendar suggestion workflow throws", async () => {
    const workflow = createPostMeetingAftercareWorkflow({
      runCalendarSuggestionWorkflow: vi.fn(async () => {
        throw new Error("Calendar provider unavailable");
      }),
      listCalendarSuggestedFollowups: vi.fn(async () => []),
    });

    const result = await run(workflow);

    expect(result).toMatchObject({
      connected: false,
      generated: 0,
      suggestedFollowups: [],
      artifact: null,
      delivery: null,
      error: "Calendar provider unavailable",
    });
  });

  it("dedupes repeated runs for the same meeting", async () => {
    const { review, workflow } = setupWorkflow();

    const first = await run(workflow);
    const second = await run(workflow);

    expect(first.generated).toBe(1);
    expect(second).toMatchObject({
      connected: true,
      generated: 0,
      suggestedFollowups: [],
      artifact: null,
    });
    await expect(review.listSuggestedFollowups(OWNER)).resolves.toHaveLength(1);
  });

  it("filters non-meeting and out-of-policy Calendar events", async () => {
    const { workflow } = setupWorkflow({
      events: [
        event({ providerEventId: "cancelled", status: "cancelled" }),
        event({ providerEventId: "future", end: new Date("2026-07-03T17:00:00.000Z") }),
        event({
          providerEventId: "solo",
          attendees: [attendee({ email: "me@tendnote.test", self: true })],
        }),
        event({ providerEventId: "allday", allDay: true }),
      ],
    });

    const result = await run(workflow);

    expect(result).toMatchObject({
      connected: true,
      generated: 0,
      suggestedFollowups: [],
      artifact: null,
    });
  });

  it("uses configured Discord delivery after the proposal artifact is persisted", async () => {
    const { delivery, workflow } = setupWorkflow({ deliverDiscord: true });
    await delivery.configureDiscordWorkflowDelivery({
      ownerUserId: OWNER,
      workflow: "post_meeting_aftercare",
      enabled: true,
      targetId: "discord-aftercare",
      allowSensitive: false,
    });
    const sender = vi.fn(async () => undefined);

    const result = await run(workflow, { deliverDiscord: true, sender });

    expect(result.delivery).toMatchObject({
      type: "sent",
      attempt: {
        artifactId: result.artifact?.artifactId,
        artifactKind: "post_meeting_aftercare",
        status: "sent",
      },
    });
    expect(sender).toHaveBeenCalledWith({
      targetId: "discord-aftercare",
      content:
        "Tendnote post meeting aftercare is ready for review: One post-meeting aftercare proposal is ready.",
    });
  });

  it("keeps proposals reviewable when Discord delivery fails", async () => {
    const { delivery, review, workflow } = setupWorkflow({ deliverDiscord: true });
    await delivery.configureDiscordWorkflowDelivery({
      ownerUserId: OWNER,
      workflow: "post_meeting_aftercare",
      enabled: true,
      targetId: "discord-aftercare",
      allowSensitive: false,
    });
    const sender = vi.fn(async () => {
      throw new Error("Discord unavailable");
    });

    const result = await run(workflow, { deliverDiscord: true, sender });

    expect(result.delivery).toMatchObject({
      type: "failed",
      error: "Discord unavailable",
      attempt: { artifactId: result.artifact?.artifactId, status: "failed" },
    });
    await expect(review.listSuggestedFollowups(OWNER)).resolves.toHaveLength(1);
  });

  it("does not import durable memory, active follow-up, draft, or external-send mutations", () => {
    const source = readFileSync(
      join(process.cwd(), "src/queries/post-meeting-aftercare.ts"),
      "utf8",
    );
    const importSources = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

    for (const moduleId of importSources) {
      expect(moduleId).not.toMatch(/queries\/(followups|memories|source-records|drafts|gmail)/);
      expect(moduleId).not.toMatch(/sendgrid|twilio|slack|resend|nodemailer/i);
    }
  });
});
