import { createDrizzleContextFactStore } from "./context-facts/drizzle-store";
import { createContextFactQueries } from "./context-facts/queries";
import type {
  AcceptSuggestedContextFactMutationInput,
  ArchiveContextFactMutationInput,
  ArchiveHouseholdContextFactMutationInput,
  ArchiveSelfContextFactMutationInput,
  ContextFactCallerVerification,
  CreateContextFactMutationInput,
  CreateHouseholdContextFactMutationInput,
  CreateSelfContextFactMutationInput,
  CreateSuggestedContextFactMutationInput,
  CreateSuggestedSelfContextFactMutationInput,
  DeleteSelfContextFactMutationInput,
  DismissSuggestedContextFactMutationInput,
  GetContextFactInput,
  GetOrientationContextInput,
  ListContextFactsInput,
  ListHouseholdContextFactsInput,
  RestoreHouseholdContextFactMutationInput,
  RestoreSelfContextFactMutationInput,
  SearchHouseholdContextFactsInput,
  SearchSelfContextFactsInput,
  UpdateContextFactMutationInput,
  UpdateHouseholdContextFactMutationInput,
  UpdateSelfContextFactMutationInput,
} from "./context-facts/types";
import { createDrizzleHouseholdStore } from "./households/drizzle-store";
import { createDrizzleSourceRecordAudienceReader } from "./source-records/drizzle-store";

export { createDrizzleContextFactStore } from "./context-facts/drizzle-store";
export { createInMemoryContextFactStore } from "./context-facts/in-memory-store";
export { createContextFactQueries } from "./context-facts/queries";
export type * from "./context-facts/types";

function createVerifiedContextFactQueries(resolveVerifiedCaller: ContextFactCallerVerification) {
  return createContextFactQueries(createDrizzleContextFactStore(), {
    householdAccess: createDrizzleHouseholdStore(),
    // The one source-record read: whether a household suggestion's evidence is
    // itself household-visible. Narrowed to that question at the seam.
    sourceRecords: createDrizzleSourceRecordAudienceReader(),
    resolveVerifiedCaller,
  });
}

export function createContextFact(
  input: CreateContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).createContextFact(input);
}

export function createSuggestedContextFact(
  input: CreateSuggestedContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).createSuggestedContextFact(input);
}

export function createSuggestedSelfContextFact(
  input: CreateSuggestedSelfContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).createSuggestedSelfContextFact(
    input,
  );
}

export function listSuggestedContextFactReviews(
  input: ListContextFactsInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).listSuggestedContextFactReviews(
    input,
  );
}

export function getSuggestedContextFactReview(
  input: GetContextFactInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).getSuggestedContextFactReview(
    input,
  );
}

export function acceptSuggestedContextFact(
  input: AcceptSuggestedContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).acceptSuggestedContextFact(input);
}

export function dismissSuggestedContextFact(
  input: DismissSuggestedContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).dismissSuggestedContextFact(input);
}

export function createSelfContextFact(
  input: CreateSelfContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).createSelfContextFact(input);
}

export function updateSelfContextFact(
  input: UpdateSelfContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).updateSelfContextFact(input);
}

export function updateContextFact(
  input: UpdateContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).updateContextFact(input);
}

export function archiveSelfContextFact(
  input: ArchiveSelfContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).archiveSelfContextFact(input);
}

export function archiveContextFact(
  input: ArchiveContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).archiveContextFact(input);
}

export function restoreSelfContextFact(
  input: RestoreSelfContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).restoreSelfContextFact(input);
}

export function deleteSelfContextFact(
  input: DeleteSelfContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).deleteSelfContextFact(input);
}

export function listHouseholdContextFacts(
  input: ListHouseholdContextFactsInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).listHouseholdContextFacts(input);
}

/** Active Household Context as an exact Global Recall result for an active member. */
export function searchHouseholdContextFacts(
  input: SearchHouseholdContextFactsInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).searchHouseholdContextFacts(input);
}

export function createHouseholdContextFact(
  input: CreateHouseholdContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).createHouseholdContextFact(input);
}

export function updateHouseholdContextFact(
  input: UpdateHouseholdContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).updateHouseholdContextFact(input);
}

export function archiveHouseholdContextFact(
  input: ArchiveHouseholdContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).archiveHouseholdContextFact(input);
}

export function restoreHouseholdContextFact(
  input: RestoreHouseholdContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).restoreHouseholdContextFact(input);
}

export function listContextFacts(
  input: ListContextFactsInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).listContextFacts(input);
}

export function listSelfContextFacts(
  input: ListContextFactsInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).listSelfContextFacts(input);
}

export function searchSelfContextFacts(
  input: SearchSelfContextFactsInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).searchSelfContextFacts(input);
}

export function listEligibleContextFacts(
  input: ListContextFactsInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).listEligibleContextFacts(input);
}

export function getContextFact(
  input: GetContextFactInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).getContextFact(input);
}

export function getSelfContextFact(
  input: GetContextFactInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).getSelfContextFact(input);
}

/** Internal Capture lifecycle read; unlike the public view it preserves provenance and versioning. */
export function getSelfContextFactForCapture(
  input: GetContextFactInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).getSelfContextFactForCapture(
    input,
  );
}

export function getOrientationContext(
  input: GetOrientationContextInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).getOrientationContext(input);
}
