import {
  createFakeSuggestedActionExtractionAdapter,
  MAX_EXTRACTED_ACTION_CANDIDATES,
} from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createSuggestedGeneralActionReview } from "../general-actions/review";
import { createHarness, OWNER } from "./harness";

/**
 * A resolved (dismissed or ignored) proposal still grounds its source record, so re-running
 * the extraction job must not re-suggest it. Shared by the dismissed- and ignored-retry
 * cases, which differ only in the review verb that resolves the first proposal and the
 * terminal status the surviving row should carry.
 */
async function expectResolvedProposalNotReintroduced(options: {
  title: string;
  resolve: (
    review: ReturnType<typeof createSuggestedGeneralActionReview>,
    generalActionId: string,
  ) => Promise<unknown>;
  expectedStatus: string;
}) {
  const adapter = createFakeSuggestedActionExtractionAdapter([{ title: options.title }]);
  const { store, processor, captureRecord, listActionsForSource } = createHarness({
    extractionAdapter: adapter,
  });
  const review = createSuggestedGeneralActionReview(store);
  const source = await captureRecord();
  const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });

  const first = await processor.processActionExtractionJob({ jobId: job.id });
  await options.resolve(review, first.suggestedActionIds[0] ?? "");

  await store.updateActionExtractionJob({ jobId: job.id, status: "pending", claimedAt: null });
  const second = await processor.processActionExtractionJob({ jobId: job.id });

  expect(second.suggestedActionIds).toHaveLength(0);
  const actions = await listActionsForSource(source.id);
  expect(actions).toHaveLength(1);
  expect(actions[0]?.status).toBe(options.expectedStatus);
}

describe("action extraction idempotency and duplicate prevention", () => {
  it("does not create duplicate proposals when a completed job is processed again", async () => {
    const adapter = createFakeSuggestedActionExtractionAdapter([
      { title: "Replace the refrigerator water filter" },
    ]);
    const { store, processor, captureRecord, listActionsForSource } = createHarness({
      extractionAdapter: adapter,
    });
    const source = await captureRecord();
    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });

    await processor.processActionExtractionJob({ jobId: job.id });
    // Force a re-run by resetting to a claimable state, simulating a redelivery.
    await store.updateActionExtractionJob({ jobId: job.id, status: "pending", claimedAt: null });
    const second = await processor.processActionExtractionJob({ jobId: job.id });

    expect(second.suggestedActionIds).toHaveLength(0);
    await expect(listActionsForSource(source.id)).resolves.toHaveLength(1);
  });

  it("dedupes proposals by normalized title within one source record", async () => {
    const adapter = createFakeSuggestedActionExtractionAdapter([
      { title: "Replace the filter" },
      { title: "  replace the FILTER " },
      { title: "Book a dentist appointment" },
    ]);
    const { processor, captureRecord, listActionsForSource } = createHarness({
      extractionAdapter: adapter,
    });
    const source = await captureRecord();
    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });

    const result = await processor.processActionExtractionJob({ jobId: job.id });

    // The two filter titles collapse to one; the dentist action is distinct.
    expect(result.suggestedActionIds).toHaveLength(2);
    const titles = (await listActionsForSource(source.id)).map((action) => action.title).sort();
    expect(titles).toEqual(["Book a dentist appointment", "Replace the filter"]);
  });

  it("does not reintroduce a dismissed proposal on retry", async () => {
    await expectResolvedProposalNotReintroduced({
      title: "Replace the refrigerator water filter",
      resolve: (review, generalActionId) =>
        review.dismissSuggestedGeneralAction({ actorUserId: OWNER, generalActionId }),
      expectedStatus: "dismissed",
    });
  });

  it("caps proposals per run so a runaway/injected record can't flood the review queue", async () => {
    const candidates = Array.from({ length: MAX_EXTRACTED_ACTION_CANDIDATES + 8 }, (_, i) => ({
      title: `Action number ${i}`,
    }));
    const { processor, captureRecord, listActionsForSource } = createHarness({
      extractionAdapter: createFakeSuggestedActionExtractionAdapter(candidates),
    });
    const source = await captureRecord();
    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });

    const result = await processor.processActionExtractionJob({ jobId: job.id });

    expect(result.suggestedActionIds).toHaveLength(MAX_EXTRACTED_ACTION_CANDIDATES);
    await expect(listActionsForSource(source.id)).resolves.toHaveLength(
      MAX_EXTRACTED_ACTION_CANDIDATES,
    );
  });

  it("does not reintroduce an ignored proposal on retry", async () => {
    await expectResolvedProposalNotReintroduced({
      title: "Water the plants",
      resolve: (review, generalActionId) =>
        review.ignoreSuggestedGeneralAction({ actorUserId: OWNER, generalActionId }),
      expectedStatus: "ignored",
    });
  });
});
