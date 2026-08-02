import { createDrizzleContextFactStore } from "./context-facts/drizzle-store";
import { createContextFactQueries } from "./context-facts/queries";
import type {
  ContextFactCallerVerification,
  CreateContextFactMutationInput,
  CreateSelfContextFactMutationInput,
  GetContextFactInput,
  ListContextFactsInput,
} from "./context-facts/types";
import { createDrizzleHouseholdStore } from "./households/drizzle-store";

export { createDrizzleContextFactStore } from "./context-facts/drizzle-store";
export { createInMemoryContextFactStore } from "./context-facts/in-memory-store";
export { createContextFactQueries } from "./context-facts/queries";
export type * from "./context-facts/types";

function createVerifiedContextFactQueries(resolveVerifiedCaller: ContextFactCallerVerification) {
  return createContextFactQueries(createDrizzleContextFactStore(), {
    householdAccess: createDrizzleHouseholdStore(),
    resolveVerifiedCaller,
  });
}

export function createContextFact(
  input: CreateContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).createContextFact(input);
}

export function createSelfContextFact(
  input: CreateSelfContextFactMutationInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).createSelfContextFact(input);
}

export function listContextFacts(
  input: ListContextFactsInput,
  resolveVerifiedCaller: ContextFactCallerVerification,
) {
  return createVerifiedContextFactQueries(resolveVerifiedCaller).listContextFacts(input);
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
