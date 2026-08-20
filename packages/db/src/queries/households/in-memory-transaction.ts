import { AsyncLocalStorage } from "node:async_hooks";

export type InMemoryTransactionResource =
  | "invitations"
  | "deliveries"
  | "households"
  | "memberships"
  | "recordShares"
  | "dissolutionConfirmations"
  | "auditLogEntries"
  | "accessProfiles";

export type InMemoryMutationLog = Map<InMemoryTransactionResource, Set<string>>;

export type InMemoryTransactionContext = {
  releases: Array<() => void>;
  snapshot?: unknown;
  mutations: InMemoryMutationLog;
};

export const inMemoryTransactionContext = new AsyncLocalStorage<InMemoryTransactionContext>();

export function recordInMemoryMutation(resource: InMemoryTransactionResource, id: string): void {
  const mutations = inMemoryTransactionContext.getStore()?.mutations;
  if (!mutations) return;
  const ids = mutations.get(resource) ?? new Set<string>();
  ids.add(id);
  mutations.set(resource, ids);
}
