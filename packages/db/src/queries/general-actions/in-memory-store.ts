import { randomUUID } from "node:crypto";
import {
  ACTIVE_GENERAL_ACTION_STATUSES,
  createGeneralActionEventSchema,
  createGeneralActionSchema,
  type GeneralAction,
  type GeneralActionEvent,
  generalActionEventSchema,
  generalActionSchema,
} from "@tendnote/domain";
import { createInMemoryGeneralActionAreaStore } from "../general-action-areas/in-memory-store";
import { createInMemorySourceRecordStore } from "../source-records/in-memory-store";
import type { GeneralActionStore, InMemoryGeneralActionLifecycleStore } from "./types";

/**
 * Minimal General Action CRUD + history store over two maps/arrays. It carries
 * only General Action methods so it can be composed with a source-record store for
 * grounding without shadowing that store's methods (mirrors the Follow-Up store).
 */
export function createInMemoryGeneralActionStore(): GeneralActionStore {
  const actions = new Map<string, GeneralAction>();
  const events: GeneralActionEvent[] = [];

  return {
    async createGeneralAction(values) {
      const parsed = createGeneralActionSchema.parse(values);
      const now = new Date();
      const action: GeneralAction = {
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      actions.set(action.id, action);

      return action;
    },
    async getGeneralAction(input) {
      const action = actions.get(input.generalActionId);

      if (!action || action.ownerUserId !== input.ownerUserId) {
        return null;
      }

      return action;
    },
    async updateGeneralAction(input) {
      const action = actions.get(input.generalActionId);

      if (!action || action.ownerUserId !== input.ownerUserId) {
        throw new Error("Action not found.");
      }

      // Re-validate the merged record so field constraints hold for direct store
      // callers too, matching the drizzle store.
      const updated = generalActionSchema.parse({
        ...action,
        ...input.patch,
        updatedAt: new Date(),
      });

      actions.set(updated.id, updated);

      return updated;
    },
    async listGeneralActionsForOwner(input) {
      const filtered = [...actions.values()]
        .filter(
          (action) =>
            action.ownerUserId === input.ownerUserId &&
            (input.statuses === undefined || input.statuses.includes(action.status)),
        )
        .sort(byActiveDueThenCreated);

      return input.limit === undefined ? filtered : filtered.slice(0, input.limit);
    },
    async createGeneralActionEvent(values) {
      const parsed = createGeneralActionEventSchema.parse(values);
      const event: GeneralActionEvent = generalActionEventSchema.parse({
        ...parsed,
        id: randomUUID(),
        createdAt: new Date(),
      });

      events.push(event);

      return event;
    },
    async listGeneralActionEvents(input) {
      return events
        .filter(
          (event) =>
            event.ownerUserId === input.ownerUserId &&
            event.generalActionId === input.generalActionId,
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
  };
}

/**
 * Orders active actions so scheduled ones surface due-first and unscheduled ones
 * fall to the end (newest first), matching the calm Actions surface. Terminal
 * actions keep the same ordering for the resolved list.
 */
function byActiveDueThenCreated(a: GeneralAction, b: GeneralAction): number {
  const aWhen = surfacingTime(a);
  const bWhen = surfacingTime(b);

  if (aWhen !== bWhen) {
    return aWhen - bWhen;
  }

  return b.createdAt.getTime() - a.createdAt.getTime();
}

/**
 * The moment an action next wants attention: its resurface date when deferred,
 * otherwise its due date. This is the shared ordering contract both stores
 * implement — the drizzle store expresses the same rule as
 * `coalesce(defer_until, due_at)` with unscheduled rows (both null) sorted last.
 * A deferred action always carries a `deferUntil` and the lifecycle clears it on
 * every non-defer transition, so `deferUntil ?? dueAt` matches the SQL coalesce.
 */
function surfacingTime(action: GeneralAction): number {
  const when = action.deferUntil ?? action.dueAt;
  // Unscheduled actions sort after everything with a concrete date.
  return when ? when.getTime() : Number.POSITIVE_INFINITY;
}

export { ACTIVE_GENERAL_ACTION_STATUSES };

/**
 * Lifecycle store for tests and composition: the General Action store plus a
 * source-record base for grounding verification and an Area base for Area-assignment
 * verification. Mirrors how the Follow-Up lifecycle store is built.
 */
export function createInMemoryGeneralActionLifecycleStore(): InMemoryGeneralActionLifecycleStore {
  return {
    ...createInMemorySourceRecordStore(),
    ...createInMemoryGeneralActionAreaStore(),
    ...createInMemoryGeneralActionStore(),
  };
}
