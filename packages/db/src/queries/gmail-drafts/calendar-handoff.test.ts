import type { CalendarSuggestedFollowup } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryCalendarSuggestionStore } from "../calendar-followups/in-memory-store";
import { createCalendarSuggestionReview } from "../calendar-followups/suggestions";
import { createDraftGenerator } from "../drafts/generator";
import { createInMemoryDraftStore } from "../drafts/in-memory-store";
import { createDraftLifecycle } from "../drafts/lifecycle";
import { createInMemoryMemoryStore } from "../memories/in-memory-store";
import { createPersonContext } from "../person-context";
import { createFakeGmailDraftAdapter } from "./fake-adapter";
import { createGmailApprovalGate } from "./gate";
import { createInMemoryGmailDraftActionStore } from "./in-memory-store";
import { createGmailDraftService } from "./service";

/**
 * Calendar → Gmail handoff boundary (Phase 2D, ADR-0093). A Calendar-derived
 * follow-up reaches Gmail ONLY through the normal Tendnote lifecycle: a reviewed
 * (accepted) suggestion becomes a follow-up, the follow-up grounds a real Tendnote
 * draft, the user approves it, and only then can it be externalized to Gmail through
 * the same shared gate as every other draft. These tests drive the actual seams
 * (calendar accept + draft generator + Gmail service), not hand-built stand-ins.
 */

const OWNER = "user-1";

function suggestion(personId: string): CalendarSuggestedFollowup {
  const now = new Date();
  return {
    id: "sug-1",
    ownerUserId: OWNER,
    providerEventId: "evt-1",
    calendarId: "primary",
    shape: "post_meeting_followup",
    personId,
    personDisplayName: "Dana",
    matchKind: "email",
    tentative: false,
    unresolvedAttendee: null,
    reason: "Follow up after the Tuesday sync",
    dueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    dedupeKey: "evt-1:dana",
    status: "suggested",
    acceptedFollowupId: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function setup() {
  // The draft generator's composed lifecycle store (draft persistence + the memory/
  // source/person/audit base) doubles as the source-of-truth the Gmail gate reads.
  const memoryStore = createInMemoryMemoryStore();
  const draftStore = createInMemoryDraftStore();
  const store = { ...memoryStore, ...draftStore };
  const personContext = createPersonContext(memoryStore);
  const person = await memoryStore.createPerson({
    ownerUserId: OWNER,
    displayName: "Dana",
    firstName: "Dana",
    lastName: null,
    birthday: null,
    relationshipType: "colleague",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });

  const generator = createDraftGenerator(store, personContext, {
    draftAdapter: async (input) => ({
      body: `Good seeing you, ${input.person.displayName}. Let's keep the thread going.`,
      provenance: { generator: "fake" },
    }),
  });

  const actionStore = createInMemoryGmailDraftActionStore();
  const gmail = createGmailDraftService({
    store: actionStore,
    adapter: createFakeGmailDraftAdapter({ draftId: "gmail-1" }),
    drafts: {
      async getDraftBody({ ownerUserId, messageDraftId }) {
        const draft = await store.getDraft({ ownerUserId, draftId: messageDraftId });
        return draft ? { body: draft.body } : null;
      },
    },
    // The SAME shared gate the web UI and Eve use (ADR-0092): connected + approved.
    authorize: createGmailApprovalGate({
      isConnected: async () => true,
      getDraftStatus: async ({ ownerUserId, draftId }) => {
        const draft = await store.getDraft({ ownerUserId, draftId });
        return draft?.status ?? null;
      },
    }),
  });

  return { store, generator, gmail, actionStore, person };
}

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  ctx = await setup();
});

describe("reviewing a Calendar suggestion promotes it into a follow-up (ADR-0093)", () => {
  it("accepts a suggested Calendar follow-up into the active follow-up lifecycle", async () => {
    const review = createCalendarSuggestionReview(
      createInMemoryCalendarSuggestionStore([suggestion(ctx.person.id)]),
    );
    const createActiveFollowup = vi.fn().mockResolvedValue({ id: "fu-1" });

    const accepted = await review.acceptSuggestedFollowup(
      { ownerUserId: OWNER, id: "sug-1" },
      { createActiveFollowup },
    );

    // The review step promotes the suggestion into a real follow-up (reviewed).
    expect(createActiveFollowup).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: OWNER,
        personId: ctx.person.id,
        reason: "Follow up after the Tuesday sync",
      }),
    );
    expect(accepted.status).toBe("accepted");
    expect(accepted.acceptedFollowupId).toBe("fu-1");
  });

  it("refuses to accept a suggestion whose attendee was never resolved to a person", async () => {
    const review = createCalendarSuggestionReview(
      createInMemoryCalendarSuggestionStore([{ ...suggestion(ctx.person.id), personId: null }]),
    );
    await expect(
      review.acceptSuggestedFollowup(
        { ownerUserId: OWNER, id: "sug-1" },
        { createActiveFollowup: vi.fn() },
      ),
    ).rejects.toThrow(/resolve the attendee/i);
  });
});

describe("a reviewed follow-up grounds a real draft that Gmail can externalize", () => {
  it("generates a follow-up-grounded draft, and Gmail externalizes only once approved", async () => {
    // The real generator grounds the draft in the reviewed follow-up as intent —
    // this is the actual grounding, not a hand-built source ref.
    const outcome = await ctx.generator.generateDraft({
      ownerUserId: OWNER,
      personId: ctx.person.id,
      purpose: "check_in",
      followupContext: { id: "fu-1", reason: "Follow up after the Tuesday sync" },
    });
    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.draft.sourceRefs).toContainEqual(
      expect.objectContaining({ kind: "followup", trust: "intent", id: "fu-1" }),
    );

    const write = {
      ownerUserId: OWNER,
      messageDraftId: outcome.draft.id,
      subject: "Following up after the sync",
      recipient: {
        email: "dana@example.com",
        source: "manual_entry" as const,
        contactMethodId: null,
      },
      idempotencyKey: `create:${outcome.draft.id}`,
    };

    // Before approval the Gmail gate blocks it — no Calendar-to-Gmail shortcut.
    const blocked = await ctx.gmail.createGmailDraft(write);
    expect(blocked.status).toBe("blocked");
    if (blocked.status === "blocked") {
      expect(blocked.reason).toMatch(/approve/i);
    }

    // After approval it externalizes through the normal gate.
    await createDraftLifecycle(ctx.store).approveDraft({
      ownerUserId: OWNER,
      draftId: outcome.draft.id,
    });
    const created = await ctx.gmail.createGmailDraft(write);
    expect(created.status).toBe("succeeded");
  });
});
