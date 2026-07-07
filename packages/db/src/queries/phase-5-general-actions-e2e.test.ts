import {
  ACTIVE_GENERAL_ACTION_STATUSES,
  classifyActionSurfacing,
  type GeneralAction,
  type HouseholdMembership,
  nextRoutineDueAt,
} from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryActionExtractionJobStore } from "./action-extraction-jobs/in-memory-store";
import { createActionExtractionProcessor } from "./action-extraction-jobs/processor";
import { createActionSummaryWorkflow, selectActionSummaryItems } from "./action-summary";
import { createGeneralActionLifecycle } from "./general-actions/lifecycle";
import { createSuggestedGeneralActionReview } from "./general-actions/review";
import { createHouseholdLifecycle } from "./households/lifecycle";
import { createInMemoryRelationshipContextSearchStore } from "./relationship-context-search/in-memory-store";
import { createRelationshipContextSearchQueries } from "./relationship-context-search/queries";
import {
  createInMemoryScheduledWorkflowDeliveryStore,
  createScheduledWorkflowDeliveryService,
} from "./scheduled-workflow-deliveries";

/**
 * Phase 5 General Actions — cross-cutting boundary + regression coverage (issue #187).
 *
 * The per-slice suites (#178–#186) each prove their own seam. This file proves the seams
 * hold when *composed*: it drives the ADR-0167 proof scenario — the recurring household
 * "replace the refrigerator water filter every 6 months" journey — through the REAL
 * services (household lifecycle, source-record capture, action extraction, the shared
 * review queue, the General Action lifecycle, exact-recall retrieval, and the scoped
 * Discord summary), and it proves the privacy gate a review-gated proposal rides is the
 * same gate on *every* read surface at once. Everything runs over the actual in-memory
 * stores the slice tests use — no mocks of the seams under test — so a regression in how
 * two slices meet is caught here even when each slice's own test still passes.
 */

const OWNER = "owner-1";
const MEMBER = "member-1";
const OUTSIDER = "outsider-1";

/**
 * A review-gated (suggested) proposal is invisible to a household member on every scoped
 * read: it is not on their active ledger, a direct GET fails closed, and their history is
 * empty. Visibility begins only at acceptance (ADRs 0151, 0152, 0153).
 */
async function expectSuggestedActionInvisibleToMember(
  lifecycle: ReturnType<typeof createGeneralActionLifecycle>,
  memberUserId: string,
  actionId: string,
) {
  expect(await lifecycle.listActiveGeneralActions({ ownerUserId: memberUserId })).toHaveLength(0);
  await expect(
    lifecycle.getGeneralAction({ actorUserId: memberUserId, generalActionId: actionId }),
  ).rejects.toThrow(/not found/i);
  expect(
    await lifecycle.listGeneralActionHistory({
      actorUserId: memberUserId,
      generalActionId: actionId,
    }),
  ).toEqual([]);
}

// Injected "now" for the deterministic proactive-surface assertions. Completion rolls a
// Routine forward from the real wall clock (the lifecycle stamps `new Date()`), so the
// post-completion assertions read the real clock rather than this fixed instant.
const NOW = new Date(2026, 6, 6, 9, 0, 0);
const DUE_TODAY = new Date(2026, 6, 6);

const SIX_MONTHS = { interval: 6, unit: "month" as const };

/**
 * Seeds a real two-person household through the on-main household lifecycle, backed by the
 * same store the General Action visibility reads consult (the lifecycle store bundles the
 * household store, so memberships written here are exactly what `canCallerView`,
 * extraction scope resolution, and the retrieval gate read back).
 */
async function seedJourney() {
  const store = createInMemoryActionExtractionJobStore();
  const households = createHouseholdLifecycle(store);
  const review = createSuggestedGeneralActionReview(store);
  const lifecycle = createGeneralActionLifecycle(store);

  const { household } = await households.createHousehold({ ownerUserId: OWNER, name: "Home" });
  await households.inviteMember({
    ownerUserId: OWNER,
    householdId: household.id,
    invitedUserId: MEMBER,
  });
  await households.acceptInvite({ householdId: household.id, userId: MEMBER });

  return { store, households, review, lifecycle, householdId: household.id };
}

/** The scoped Discord summary workflow, reading the owner's OWN active Actions from the store. */
function summaryWorkflow(
  store: Awaited<ReturnType<typeof seedJourney>>["store"],
  delivery: ReturnType<typeof createScheduledWorkflowDeliveryService>,
) {
  return createActionSummaryWorkflow({
    listOwnerActiveActions: ({ ownerUserId }) =>
      store.listGeneralActionsForOwner({
        ownerUserId,
        statuses: [...ACTIVE_GENERAL_ACTION_STATUSES],
      }),
    deliverDiscordScheduledArtifact: (input) => delivery.deliverDiscordScheduledArtifact(input),
  });
}

/**
 * Exact-recall queries over a snapshot of the given General Action rows. Both the drizzle
 * and in-memory retrieval stores route every read through the shared
 * `canRetrieveGeneralAction` gate (Spec-verified), so seeding this store from a canonical
 * row read out of the lifecycle store exercises that gate against the same status + scope
 * the ledger reads — the equivalence rests on the shared gate, not on shared state.
 */
function recallQueries(rows: GeneralAction[], memberships: HouseholdMembership[]) {
  return createRelationshipContextSearchQueries(
    createInMemoryRelationshipContextSearchStore({
      generalActions: rows,
      householdMemberships: memberships,
    }),
  );
}

describe("Phase 5 proof scenario (ADR 0167) — the recurring household water filter", () => {
  it("carries a captured recurring household action end to end: capture → extract → review → ledger/Today → complete/roll-forward → summary", async () => {
    const { store, review, lifecycle, householdId } = await seedJourney();

    // The owner keeps a "Home maintenance" Area, so extraction can file the proposal under
    // an existing flat Area (Areas are never invented by extraction; ADR 0146/0151).
    const area = await store.createArea({
      ownerUserId: OWNER,
      name: "Home maintenance",
      sortOrder: 0,
    });

    // 1) CAPTURE — a household-scoped source record grounds everything downstream. The
    //    household scope on the *record* is the only thing that can license a household
    //    proposal (capture context can never widen scope on its own; ADR 0140).
    const source = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Replace the refrigerator water filter every 6 months.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "high",
      sensitivity: "normal",
      scope: "household",
      householdId,
      importance: 3,
      metadataJson: {},
    });

    // 2) EXTRACT — the extraction pipeline turns the captured record into a review-gated
    //    Suggested General Action through the shared `suggestGeneralAction` seam. A fake
    //    adapter stands in for the LLM; everything after it is the real processor.
    const processor = createActionExtractionProcessor(store, {
      extractionAdapter: {
        kind: "fake",
        async extractActions() {
          return {
            candidates: [
              {
                title: "Replace the refrigerator water filter",
                recurrence: SIX_MONTHS,
                dueAt: DUE_TODAY,
                areaId: area.id,
                assetHints: [{ label: "refrigerator water filter" }],
                scope: "household",
              },
            ],
          };
        },
      },
    });

    const { job } = await processor.enqueueActionExtractionJob({
      sourceRecordId: source.id,
      runAfter: NOW,
    });
    const processed = await processor.processActionExtractionJob({ jobId: job.id, now: NOW });
    expect(processed.outcome).toBe("completed");
    expect(processed.suggestedActionIds).toHaveLength(1);
    const actionId = processed.suggestedActionIds[0] as string;

    // Extraction is idempotent: a re-run over the same record proposes nothing new (deduped
    // by normalized title against actions already grounded in the record).
    const { job: rerunJob } = await processor.enqueueActionExtractionJob({
      sourceRecordId: source.id,
    });
    expect(rerunJob.id).toBe(job.id); // one job per source record

    // 3) PRE-ACCEPT INVARIANTS — a `suggested` proposal is nobody's active work yet.
    //    Not on the owner's ledger, and — even though it is household-scoped — invisible to
    //    the member across visible reads and history (visibility begins at acceptance).
    expect(await lifecycle.listActiveGeneralActions({ ownerUserId: OWNER })).toHaveLength(0);
    await expectSuggestedActionInvisibleToMember(lifecycle, MEMBER, actionId);

    // The proposal IS in the owner's review queue, grounded in the source record, filed
    // under the matched Area, and carrying the extracted recurrence and asset hint.
    const reviews = await review.listSuggestedGeneralActionReviews({ ownerUserId: OWNER });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.action.id).toBe(actionId);
    expect(reviews[0]?.sourceRecord?.id).toBe(source.id);
    expect(reviews[0]?.action.areaId).toBe(area.id);
    expect(reviews[0]?.action.recurrence).toEqual(SIX_MONTHS);
    expect(reviews[0]?.action.assetHints).toEqual([{ label: "refrigerator water filter" }]);

    // 4) REVIEW ACCEPT — promotes the proposal *in place* to a durable open Routine (a
    //    cadence makes it a Routine; ADR 0148), keeping its household scope and grounding.
    const accepted = await review.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(accepted.action.status).toBe("open");
    expect(accepted.action.recurrence).toEqual(SIX_MONTHS);
    expect(accepted.action.scope).toBe("household");
    expect(accepted.action.sourceRecordId).toBe(source.id);

    // History records the whole grounded trail: suggested → promoted (no analytics/scoring).
    const historyKinds = (
      await lifecycle.listGeneralActionHistory({ actorUserId: OWNER, generalActionId: actionId })
    ).map((event) => event.kind);
    expect(historyKinds).toEqual(["suggested", "promoted"]);

    // Accepting the same proposal again is idempotent — one row, no duplicate Action.
    const reaccepted = await review.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(reaccepted.action.id).toBe(actionId);
    expect(await store.listGeneralActionsForOwner({ ownerUserId: OWNER })).toHaveLength(1);

    // 5) LEDGER + TODAY — the promoted Routine is now on the owner's active ledger and on
    //    the member's (household scope), and it classifies as "due today" on the shared
    //    proactive-surface boundary both Action Today and the summary use.
    const ownerLedger = await lifecycle.listActiveGeneralActions({ ownerUserId: OWNER });
    expect(ownerLedger.map((a) => a.id)).toEqual([actionId]);
    const memberLedger = await lifecycle.listActiveGeneralActions({ ownerUserId: MEMBER });
    expect(memberLedger.map((a) => a.id)).toEqual([actionId]);
    // A non-member sees nothing across the household boundary.
    expect(await lifecycle.listActiveGeneralActions({ ownerUserId: OUTSIDER })).toHaveLength(0);

    const canonical = await store.getGeneralAction({
      ownerUserId: OWNER,
      generalActionId: actionId,
    });
    expect(canonical && classifyActionSurfacing(canonical, NOW)).toBe("due_today");

    // 6) RETRIEVAL — the durable household Routine is retrievable by the member (exact
    //    recall over the canonical row), and stays invisible to the non-member. Retrieval
    //    applies the shared `canRetrieveGeneralAction` gate to the row's current status +
    //    scope — the same policy the ledger read above rides — so the two agree by
    //    construction, not by chance.
    const memberships = await store.listHouseholdMemberships({ householdId, status: "active" });
    const rows = [canonical as GeneralAction];
    const memberRecall = await recallQueries(rows, memberships).searchRelationshipContext({
      ownerUserId: MEMBER,
      query: "water filter",
    });
    expect(memberRecall.map((r) => r.recordId)).toEqual([actionId]);
    expect(memberRecall[0]?.generalAction).toMatchObject({ isRoutine: true, status: "open" });
    const outsiderRecall = await recallQueries(rows, memberships).searchRelationshipContext({
      ownerUserId: OUTSIDER,
      query: "water filter",
    });
    expect(outsiderRecall).toHaveLength(0);

    // 7) SCOPED DISCORD SUMMARY — the owner's summary counts the household Routine and
    //    delivers to a matching household Discord target. The payload is COUNT-ONLY (no
    //    title leaks onto the channel), and its scope aggregates to household.
    const delivery = createScheduledWorkflowDeliveryService(
      createInMemoryScheduledWorkflowDeliveryStore(),
    );
    await delivery.configureDiscordWorkflowDelivery({
      ownerUserId: OWNER,
      workflow: "action_summary",
      enabled: true,
      targetId: "discord-household",
      allowSensitive: false,
      targetScope: "household",
      targetHouseholdId: householdId,
    });
    const sender = vi.fn(async (_message: { targetId: string; content: string }) => undefined);
    const summary = await summaryWorkflow(store, delivery).generateActionSummary({
      ownerUserId: OWNER,
      localDate: "2026-07-06",
      now: NOW,
      deliverDiscord: true,
      sender,
    });
    expect(summary.items.map((i) => [i.action.id, i.reason])).toEqual([[actionId, "due_today"]]);
    expect(summary.artifact).toMatchObject({
      scope: "household",
      householdId,
      summary: "1 action is ready for today.",
    });
    expect(summary.delivery).toMatchObject({ type: "sent" });
    const delivered = sender.mock.calls[0]?.[0];
    expect(delivered?.content).toContain("1 action is ready for today.");
    // The count-only line never carries the action's title.
    expect(delivered?.content).not.toContain("water filter");

    // 8) COMPLETE + ROLL FORWARD — a household member completes the shared occurrence. The
    //    Routine does not retire: it stays open, rolls its due date one cadence step forward
    //    from the completion moment, and records who acted (member) while staying owner-keyed.
    const beforeComplete = new Date();
    const completed = await lifecycle.completeGeneralAction({
      actorUserId: MEMBER,
      generalActionId: actionId,
    });
    expect(completed.status).toBe("open");
    expect(completed.recurrence).toEqual(SIX_MONTHS);
    const expectedNext = nextRoutineDueAt(SIX_MONTHS, beforeComplete);
    // The rolled-forward due date lands ~6 months out (allow a small window for the wall
    // clock advancing between `beforeComplete` and the internal completion stamp).
    expect(completed.dueAt).not.toBeNull();
    const nextDue = completed.dueAt as Date;
    expect(Math.abs(nextDue.getTime() - expectedNext.getTime())).toBeLessThan(
      3 * 24 * 60 * 60 * 1000,
    );

    const completionEvent = (
      await lifecycle.listGeneralActionHistory({ actorUserId: OWNER, generalActionId: actionId })
    ).at(-1);
    expect(completionEvent).toMatchObject({
      kind: "completed",
      ownerUserId: OWNER, // owner-keyed provenance…
      actorUserId: MEMBER, // …with the member recorded as the actor (ADR 0154)
      detailJson: expect.objectContaining({ rolledForward: true }),
    });

    // After roll-forward the Routine is no longer "on today", so the same-day summary is
    // empty and self-suppresses (a "nothing is due" proactive send is a nag; ADR 0162).
    const realNow = new Date();
    const rolled = await store.getGeneralAction({ ownerUserId: OWNER, generalActionId: actionId });
    expect(rolled && classifyActionSurfacing(rolled, realNow)).toBeNull();
    const emptySummary = await summaryWorkflow(store, delivery).generateActionSummary({
      ownerUserId: OWNER,
      localDate: "2026-07-06",
      now: realNow,
      deliverDiscord: true,
      sender,
    });
    expect(emptySummary.items).toHaveLength(0);
    expect(emptySummary.delivery).toBeNull();
  });
});

describe("Phase 5 privacy under composition — a review-gated household proposal is invisible on every read surface", () => {
  it("hides a suggested household action from a member across ledger, history, review queue, Today/summary, and retrieval — and opens exactly at acceptance", async () => {
    const { store, review, lifecycle, householdId } = await seedJourney();

    const source = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Household chore to propose.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "high",
      sensitivity: "normal",
      scope: "household",
      householdId,
      importance: 3,
      metadataJson: {},
    });

    // A household-scoped PROPOSAL: the strongest privacy case — a member could see it once
    // it is a durable household action, so the only thing keeping it hidden now is the
    // review gate, exercised here across every surface at once (ADRs 0151–0153).
    const proposed = await review.suggestGeneralAction({
      ownerUserId: OWNER,
      title: "Deep clean the garage",
      sourceRecordId: source.id,
      scope: "household",
      householdId,
    });
    const actionId = proposed.action.id;

    const memberships = await store.listHouseholdMemberships({ householdId, status: "active" });
    // Re-reads the canonical row on each call so retrieval always reflects the row's current
    // status as it moves suggested → open through the real review seam.
    const recallFor = async (userId: string, includeReviewGated: boolean) => {
      const row = await store.getGeneralAction({ ownerUserId: OWNER, generalActionId: actionId });
      return recallQueries([row as GeneralAction], memberships).searchRelationshipContext({
        ownerUserId: userId,
        query: "garage",
        includeReviewGated,
      });
    };

    // --- MEMBER: invisible everywhere while suggested ---
    // ledger, direct visible read + history
    await expectSuggestedActionInvisibleToMember(lifecycle, MEMBER, actionId);
    // review queue (owner-scoped; a member has none)
    expect(await review.listSuggestedGeneralActionReviews({ ownerUserId: MEMBER })).toHaveLength(0);
    // Today / summary selection (a suggested row is not a durable action, so it never
    // reaches the shared proactive-surface boundary even with a due date)
    const memberActive = await store.listGeneralActionsForOwner({
      ownerUserId: MEMBER,
      statuses: [...ACTIVE_GENERAL_ACTION_STATUSES],
    });
    expect(selectActionSummaryItems(memberActive, NOW)).toHaveLength(0);
    // retrieval — even asking for review-gated context, a member never reaches another
    // owner's proposal
    expect(await recallFor(MEMBER, true)).toHaveLength(0);

    // --- OWNER: reachable only through the owner-only review paths ---
    expect(await lifecycle.listActiveGeneralActions({ ownerUserId: OWNER })).toHaveLength(0); // not durable yet
    expect(await review.listSuggestedGeneralActionReviews({ ownerUserId: OWNER })).toHaveLength(1);
    expect(await recallFor(OWNER, false)).toHaveLength(0); // no proposal without review context
    const ownerReview = await recallFor(OWNER, true);
    expect(ownerReview.map((r) => r.recordId)).toEqual([actionId]);

    // --- ACCEPTANCE OPENS THE GATE — every surface flips consistently in one step ---
    await review.acceptSuggestedGeneralAction({ actorUserId: OWNER, generalActionId: actionId });

    // ledger + retrieval now show it to the member; the gate opened exactly at acceptance.
    const memberLedger = await lifecycle.listActiveGeneralActions({ ownerUserId: MEMBER });
    expect(memberLedger.map((a) => a.id)).toEqual([actionId]);
    const memberRecall = await recallFor(MEMBER, false);
    expect(memberRecall.map((r) => r.recordId)).toEqual([actionId]);
    // A member reading the now-durable action's history sees the owner-keyed trail.
    expect(
      (
        await lifecycle.listGeneralActionHistory({ actorUserId: MEMBER, generalActionId: actionId })
      ).map((e) => e.kind),
    ).toEqual(["suggested", "promoted"]);
  });
});
