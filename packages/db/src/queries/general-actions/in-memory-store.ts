import { randomUUID } from "node:crypto";
import {
  ACTIVE_GENERAL_ACTION_STATUSES,
  canViewScopedRecord,
  createGeneralActionEventSchema,
  createGeneralActionSchema,
  type GeneralAction,
  type GeneralActionEvent,
  generalActionEventSchema,
  generalActionSchema,
  scopedRecordVisibility,
} from "@tendnote/domain";
import { createInMemoryGeneralActionAreaStore } from "../general-action-areas/in-memory-store";
import { createInMemoryHouseholdStore } from "../households/in-memory-store";
import type { HouseholdStore } from "../households/types";
import { createInMemorySourceRecordStore } from "../source-records/in-memory-store";
import type { GeneralActionStore, InMemoryGeneralActionLifecycleStore } from "./types";

/**
 * Minimal General Action CRUD + history + people-link store over a few maps. It
 * carries only General Action methods plus a bundled household store so it can be
 * composed with a source-record store for grounding without shadowing that store's
 * methods (mirrors the Follow-Up store). The bundled household store is the same
 * instance the visibility reads consult and the lifecycle writes shares to, so scope
 * state stays consistent across the composed seam (ADR 0153).
 */
export function createInMemoryGeneralActionStore(): GeneralActionStore & HouseholdStore {
  const actions = new Map<string, GeneralAction>();
  const events: GeneralActionEvent[] = [];
  // Person links as (generalActionId -> ordered set of personIds).
  const peopleLinks = new Map<string, string[]>();
  const householdStore = createInMemoryHouseholdStore();

  /**
   * Whether `callerUserId` may see `action` under the Phase 4 scope rules: private is
   * owner-only; household is any active member of the action's household; shared is
   * the owner plus explicitly selected members. Fail closed — a non-private action
   * with no household is visible to no one (ADR 0153).
   */
  async function canCallerView(input: { callerUserId: string; action: GeneralAction }) {
    const activeMemberships = input.action.householdId
      ? await householdStore.listHouseholdMemberships({
          householdId: input.action.householdId,
          status: "active",
        })
      : [];
    const shares =
      input.action.scope === "shared" && input.action.householdId
        ? await householdStore.listHouseholdRecordShares({
            householdId: input.action.householdId,
            recordKind: "general_action",
            recordId: input.action.id,
          })
        : [];

    return canViewScopedRecord({
      callerUserId: input.callerUserId,
      record: scopedRecordVisibility({
        ownerUserId: input.action.ownerUserId,
        scope: input.action.scope,
        householdId: input.action.householdId,
        shares,
      }),
      activeMemberships,
    });
  }

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
    async getVisibleGeneralAction(input) {
      const action = actions.get(input.generalActionId);

      if (!action || !(await canCallerView({ callerUserId: input.callerUserId, action }))) {
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
    async listVisibleGeneralActionsForCaller(input) {
      const visible: GeneralAction[] = [];
      for (const action of actions.values()) {
        if (
          (input.statuses === undefined || input.statuses.includes(action.status)) &&
          (await canCallerView({ callerUserId: input.callerUserId, action }))
        ) {
          visible.push(action);
        }
      }

      visible.sort(byActiveDueThenCreated);
      return input.limit === undefined ? visible : visible.slice(0, input.limit);
    },
    async setGeneralActionPeople(input) {
      // Owner-keyed: a direct store caller can only rewrite links on an action they
      // own, mirroring `updateGeneralAction`.
      const action = actions.get(input.generalActionId);
      if (!action || action.ownerUserId !== input.ownerUserId) {
        throw new Error("Action not found.");
      }
      // Dedupe while preserving order so the link set is stable across writes.
      const unique = [...new Set(input.personIds)];
      if (unique.length === 0) {
        peopleLinks.delete(input.generalActionId);
        return;
      }
      peopleLinks.set(input.generalActionId, unique);
    },
    async listGeneralActionPersonIds(input) {
      // Owner-keyed: returns nothing for an action the caller does not own.
      const action = actions.get(input.generalActionId);
      if (!action || action.ownerUserId !== input.ownerUserId) {
        return [];
      }
      return [...(peopleLinks.get(input.generalActionId) ?? [])];
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
    ...householdStore,
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
 * Lifecycle store for tests and composition: the General Action store (with its
 * bundled household store) plus a source-record base for grounding and owner-scoped
 * person resolution, and an Area base for Area-assignment verification. Mirrors how
 * the Follow-Up lifecycle store is built.
 */
export function createInMemoryGeneralActionLifecycleStore(): InMemoryGeneralActionLifecycleStore {
  return {
    ...createInMemorySourceRecordStore(),
    ...createInMemoryGeneralActionAreaStore(),
    ...createInMemoryGeneralActionStore(),
  };
}
