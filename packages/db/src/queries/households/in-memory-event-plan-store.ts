import { randomUUID } from "node:crypto";
import type { HouseholdEventPlan, HouseholdEventPlanLink } from "@tendnote/domain";
import type {
  HouseholdEventPlanLinkTargetFacts,
  HouseholdEventPlanLinkTargetStore,
  HouseholdEventPlanStore,
} from "./event-plan-types";

export type InMemoryHouseholdEventPlanStore = HouseholdEventPlanStore & {
  /** Test helper: every stored plan, ignoring visibility. */
  allPlans: () => HouseholdEventPlan[];
};

/** Deterministic in-memory Event Plan store for tests. No database, no clock. */
export function createInMemoryHouseholdEventPlanStore(): InMemoryHouseholdEventPlanStore {
  const plans = new Map<string, HouseholdEventPlan>();
  const links = new Map<string, HouseholdEventPlanLink>();

  return {
    async listPlans(input) {
      return [...plans.values()]
        .filter(
          (plan) =>
            plan.householdId === input.householdId &&
            (input.status ? plan.status === input.status : true),
        )
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    },

    async getPlan(input) {
      return plans.get(input.planId) ?? null;
    },

    async createPlan(input) {
      const plan: HouseholdEventPlan = {
        id: randomUUID(),
        householdId: input.householdId,
        createdByUserId: input.actorUserId,
        lastActorUserId: input.actorUserId,
        title: input.title,
        details: input.details,
        plannedFor: input.plannedFor,
        status: "active",
        archivedAt: null,
        calendarConnectionId: input.calendarConnectionId,
        calendarId: input.calendarId,
        calendarProviderEventId: input.calendarProviderEventId,
        version: 1,
        createdAt: input.at,
        updatedAt: input.at,
      };
      plans.set(plan.id, plan);
      return plan;
    },

    async applyPlanWrite(input) {
      const current = plans.get(input.planId);
      // The same fence the SQL half applies in its WHERE clause: a mismatched
      // version writes nothing and reports it, rather than winning.
      if (!current || current.version !== input.expectedVersion) return null;

      const updated: HouseholdEventPlan = {
        ...current,
        ...input.patch,
        lastActorUserId: input.actorUserId,
        version: current.version + 1,
        updatedAt: input.at,
      };
      plans.set(updated.id, updated);
      return updated;
    },

    async listLinks(input) {
      const planIds = new Set(input.planIds);
      return [...links.values()]
        .filter((link) => planIds.has(link.planId))
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    },

    async createLink(input) {
      const existing = [...links.values()].find(
        (link) =>
          link.planId === input.planId &&
          link.linkKind === input.linkKind &&
          link.recordId === input.recordId,
      );
      if (existing) return existing;

      const link: HouseholdEventPlanLink = {
        id: randomUUID(),
        planId: input.planId,
        linkKind: input.linkKind,
        recordId: input.recordId,
        linkedByUserId: input.linkedByUserId,
        createdAt: input.at,
      };
      links.set(link.id, link);
      return link;
    },

    async deleteLink(input) {
      const link = links.get(input.linkId);
      if (!link || link.planId !== input.planId) return false;
      links.delete(input.linkId);
      return true;
    },

    allPlans() {
      return [...plans.values()];
    },
  };
}

export type InMemoryHouseholdEventPlanLinkTargetStore = HouseholdEventPlanLinkTargetStore & {
  seed: (input: {
    linkKind: HouseholdEventPlanLink["linkKind"];
    recordId: string;
    facts: HouseholdEventPlanLinkTargetFacts;
  }) => void;
};

/** Seedable link-target facts, so tests can describe a target without its whole domain. */
export function createInMemoryHouseholdEventPlanLinkTargetStore(): InMemoryHouseholdEventPlanLinkTargetStore {
  const targets = new Map<string, HouseholdEventPlanLinkTargetFacts>();

  return {
    seed(input) {
      targets.set(`${input.linkKind}:${input.recordId}`, input.facts);
    },
    async readFacts(input) {
      return targets.get(`${input.linkKind}:${input.recordId}`) ?? null;
    },
  };
}
