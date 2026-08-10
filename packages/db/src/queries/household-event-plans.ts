import type { HouseholdEventPlanDraft, HouseholdEventPlanLinkKind } from "@tendnote/domain";
import { createHouseholdAuthorizationProver } from "./households/authorization";
import {
  createDrizzleHouseholdEventPlanLinkTargetStore,
  createDrizzleHouseholdEventPlanStore,
} from "./households/drizzle-event-plan-store";
import { createDrizzleHouseholdStore } from "./households/drizzle-store";
import { createHouseholdEventPlanLifecycle } from "./households/event-plans";

export {
  createDrizzleHouseholdEventPlanLinkTargetStore,
  createDrizzleHouseholdEventPlanStore,
} from "./households/drizzle-event-plan-store";
export type {
  HouseholdEventPlanLinkTargetFacts,
  HouseholdEventPlanLinkTargetStore,
  HouseholdEventPlanProvedLink,
  HouseholdEventPlanStore,
} from "./households/event-plan-types";
export {
  createHouseholdEventPlanLifecycle,
  HOUSEHOLD_EVENT_PLAN_KIND,
  type HouseholdEventPlanLifecycle,
  type HouseholdEventPlanWithLinks,
} from "./households/event-plans";
export {
  createInMemoryHouseholdEventPlanLinkTargetStore,
  createInMemoryHouseholdEventPlanStore,
} from "./households/in-memory-event-plan-store";

const householdStore = createDrizzleHouseholdStore();

const defaultEventPlans = createHouseholdEventPlanLifecycle({
  households: householdStore,
  plans: createDrizzleHouseholdEventPlanStore(),
  linkTargets: createDrizzleHouseholdEventPlanLinkTargetStore(),
  prover: createHouseholdAuthorizationProver(householdStore),
});

/**
 * The Household Event Plan entry points.
 *
 * One query/mutation layer for a household-native record family, so member
 * authority, concurrency, provenance, typed links, and lifecycle are decided
 * once and every adapter - Household, Today, Eve, Capture, Review, Search -
 * composes the same answers. Like every Household entry point, none takes a
 * household id, and every one obtains a fresh Authorization Proof for the exact
 * operation about to happen (ADR 0219).
 */
export function listHouseholdEventPlans(input: {
  callerUserId: string;
  status?: "active" | "archived";
}) {
  return defaultEventPlans.listHouseholdEventPlans(input);
}

export function getHouseholdEventPlan(input: { callerUserId: string; planId: string }) {
  return defaultEventPlans.getHouseholdEventPlan(input);
}

export function createHouseholdEventPlan(input: {
  callerUserId: string;
  draft: HouseholdEventPlanDraft;
}) {
  return defaultEventPlans.createHouseholdEventPlan(input);
}

export function updateHouseholdEventPlan(input: {
  callerUserId: string;
  planId: string;
  expectedVersion: number;
  draft: HouseholdEventPlanDraft;
}) {
  return defaultEventPlans.updateHouseholdEventPlan(input);
}

export function archiveHouseholdEventPlan(input: {
  callerUserId: string;
  planId: string;
  expectedVersion: number;
}) {
  return defaultEventPlans.archiveHouseholdEventPlan(input);
}

export function restoreHouseholdEventPlan(input: {
  callerUserId: string;
  planId: string;
  expectedVersion: number;
}) {
  return defaultEventPlans.restoreHouseholdEventPlan(input);
}

export function linkHouseholdEventPlanRecord(input: {
  callerUserId: string;
  planId: string;
  linkKind: HouseholdEventPlanLinkKind;
  recordId: string;
}) {
  return defaultEventPlans.linkHouseholdEventPlanRecord(input);
}

export function unlinkHouseholdEventPlanRecord(input: {
  callerUserId: string;
  planId: string;
  linkId: string;
}) {
  return defaultEventPlans.unlinkHouseholdEventPlanRecord(input);
}

/** Whether this household already has a Plan for one calendar event. */
export function findHouseholdEventPlanForCalendarEvent(input: {
  callerUserId: string;
  connectionId: string;
  providerEventId: string;
}) {
  return defaultEventPlans.findPlanForCalendarEvent(input);
}
