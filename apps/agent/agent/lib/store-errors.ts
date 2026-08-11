import {
  AssetValidationError,
  GeneralActionValidationError,
  GiftPlanValidationError,
  HouseholdRecordUnavailableError,
} from "@tendnote/domain";

/**
 * What a tool may say when a store call fails for a reason that is not the caller's to
 * fix. It is deliberately a *terminal* instruction: the failure Eve actually hit in the
 * wild was a bad id, and its first instinct was to guess a different one and call again,
 * turning one failure into a retry loop the user watched happen.
 */
const OPAQUE_STORE_FAILURE =
  "Could not read the user's records right now. Tell them plainly that this did not " +
  "work, and do not retry the call with a different id or a guessed value.";

/**
 * Runs a store call from a tool and guarantees that whatever comes back out is safe to
 * put in front of the model.
 *
 * **A thrown tool error is model-visible content.** The AI SDK turns it into the tool
 * result, so `error.message` lands verbatim in the model's context. Drizzle's message is
 * `Failed query: select ... from "assets" where ... params: <the bound values>` — so a
 * store error that escapes a tool hands the model the schema, the SQL, and the user's own
 * values, and invites it to reason about the database instead of the user. That is how a
 * hallucinated `assetId` became a `22P02` transcript in chat.
 *
 * The rule mirrors the shared owner-action protocol used by web surfaces: a
 * curated {@link AssetValidationError} is a sentence the domain wrote *for a person*, so
 * it passes through; everything else is infrastructure, and infrastructure gets one
 * opaque sentence and a line in the operator's log. Fail closed on the model's side too —
 * a denial and a fault must not be told apart by the shape of the error text.
 */
export async function withModelSafeStoreErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof AssetValidationError ||
      error instanceof GeneralActionValidationError ||
      error instanceof GiftPlanValidationError
    ) {
      throw error;
    }

    /**
     * The Household Authorization Proof's refusal, which is already the one
     * sentence a refused caller is ever told.
     *
     * It passes through rather than being folded into the infrastructure message
     * because it is *more* opaque, not less: "That's no longer available." names no
     * record, household, member, or reason, and it says the true thing — nothing
     * broke. Swallowing it would tell a Surprise Subject that Tendnote had a
     * problem reading something, which is a fact about a record they must not
     * learn exists (ADR 0219).
     */
    if (error instanceof HouseholdRecordUnavailableError) {
      throw error;
    }

    console.error("Tool store call failed.", error);
    throw new Error(OPAQUE_STORE_FAILURE);
  }
}
