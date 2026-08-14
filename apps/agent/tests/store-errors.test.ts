import {
  AssetConflictError,
  AssetValidationError,
  ContextFactConflictError,
  ContextFactValidationError,
  ConversationalCaptureUndoError,
  GeneralActionValidationError,
  GiftPlanConflictError,
  GiftPlanValidationError,
  HouseholdAdmissionConflictError,
  HouseholdRecordUnavailableError,
  HouseholdValidationError,
  PersonReferenceValidationError,
  RelationshipShareValidationError,
  SavedItemConflictError,
  SavedItemUnavailableDestinationError,
  SavedItemValidationError,
} from "@tendnote/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withModelSafeStoreErrors } from "../agent/lib/store-errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("model-safe tool store errors", () => {
  it("preserves curated domain validation sentences", async () => {
    // Widened past the original three families. Each of these classes documents that
    // its `message` is written for a person and safe to render beside the field that
    // produced it, which is the same bar as putting it in a chat reply. Before this,
    // 40 of 58 tools were unwrapped precisely because wrapping them would have
    // swallowed a curated sentence into the opaque one.
    const errors = [
      new AssetValidationError("Choose a narrower audience."),
      new GeneralActionValidationError("Only a routine can be paused."),
      new GiftPlanValidationError("This plan is closed to new ideas."),
      new ContextFactValidationError("A Context Fact needs content."),
      new HouseholdValidationError("That workspace is full."),
      new PersonReferenceValidationError("Use a name, not contact details."),
      new RelationshipShareValidationError("Pick who this is shared with."),
      new SavedItemValidationError("A link capture must remain a valid URL."),
      new SavedItemUnavailableDestinationError("Tendnote cannot save that yet."),
      new ConversationalCaptureUndoError("not_found", "That Saved Item is no longer available."),
    ];

    for (const error of errors) {
      await expect(withModelSafeStoreErrors(() => Promise.reject(error))).rejects.toBe(error);
    }
  });

  it("preserves a curated subclass through its parent, never by name", async () => {
    // Conflict variants are separate classes so surfaces can branch on the type
    // rather than the sentence. The allowlist is `instanceof`-based, so each rides
    // in on its parent and a future subclass is covered the day it is written.
    const errors = [
      new ContextFactConflictError("You already have a fact about that.", "fact-1"),
      new HouseholdAdmissionConflictError("You are already in a workspace."),
      new SavedItemConflictError({
        savedItemId: "item-1",
        version: 2,
        title: "Filter model",
      } as never),
      new AssetConflictError("Someone else changed this.", {
        currentValue: null,
        actorUserId: null,
        revision: 2,
      }),
      new GiftPlanConflictError("Someone else changed this.", {
        currentValue: null,
        actorUserId: null,
        revision: 2,
      }),
    ];

    for (const error of errors) {
      await expect(withModelSafeStoreErrors(() => Promise.reject(error))).rejects.toBe(error);
    }
  });

  it("preserves the Household proof's own refusal, which is already the opaque one", async () => {
    // "That's no longer available." names no record, household, member, or reason,
    // and it says the true thing: nothing broke. Folding it into the infrastructure
    // message would tell a refused caller that Tendnote had trouble reading
    // something, which is itself a fact about a record they must not learn exists.
    const refusal = new HouseholdRecordUnavailableError();

    await expect(withModelSafeStoreErrors(() => Promise.reject(refusal))).rejects.toBe(refusal);
  });

  it("replaces infrastructure details with one opaque model-safe sentence", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = withModelSafeStoreErrors(() =>
      Promise.reject(new Error('Failed query: select * from "general_actions" params: secret')),
    );

    await expect(failure).rejects.toThrow("Could not read the user's records right now.");
    await expect(failure).rejects.not.toThrow(/general_actions|secret|select/i);
  });
});
