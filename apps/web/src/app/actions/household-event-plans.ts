"use server";

import {
  archiveHouseholdEventPlan,
  createHouseholdEventPlan,
  type HouseholdEventPlanWithLinks,
  linkHouseholdEventPlanRecord,
  restoreHouseholdEventPlan,
  unlinkHouseholdEventPlanRecord,
  updateHouseholdEventPlan,
} from "@tendnote/db/queries/household-event-plans";
import {
  type HouseholdEventPlan,
  HouseholdEventPlanConflictError,
  type HouseholdEventPlanLinkKind,
  householdEventPlanLinkKindSchema,
} from "@tendnote/domain/household-event-plans";
import { z } from "zod";
import { readHouseholdEventPlans } from "@/lib/household/household-shared-data";
import type { OwnerActionResult } from "@/lib/owner-action";
import { runOwnerAction } from "@/lib/owner-action";

/**
 * Household Event Plan mutations (issue #387).
 *
 * Every active member has the same authority here - the creator and a Household
 * Owner have none beyond anyone else's - so none of these actions takes an actor
 * or a role. The caller comes from the session gate and the household from their
 * own active membership, and the shared lifecycle obtains a fresh Authorization
 * Proof for the exact operation before it happens (ADR 0219).
 *
 * Each answers with the household's whole refreshed Plan list rather than the
 * Plan it touched: archiving moves a record between two groups, restoring moves
 * it back, and an edit can change where a Plan sorts. Returning one row would
 * leave the surface recomputing an order it does not own.
 */

/**
 * A material write either landed or lost its fence. A lost fence is data, not a
 * failure: it carries the value that beat the member and who wrote it, because
 * the surface has to show both sides and let them keep, revise, or replace.
 * Tendnote never silently last-write-wins.
 */
export type HouseholdEventPlanMutation =
  | { outcome: "saved"; plans: HouseholdEventPlanWithLinks[] }
  | { outcome: "conflict"; message: string; current: HouseholdEventPlan };

export type HouseholdEventPlanResult = OwnerActionResult<HouseholdEventPlanMutation>;

/**
 * The date field accepts only a calendar day, the shape `<input type="date">`
 * produces. A stale or hand-built client gets one curated sentence rather than a
 * parser's opinion, and never a silently invalid date on a household record.
 */
const plannedForSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-08-15, or leave it blank.")
  .nullable()
  .optional();

/**
 * Length here is a payload bound, not the product rule: the title and notes
 * limits belong to the domain, which refuses an over-long draft in the household's
 * own words instead of truncating it.
 */
const draftSchema = z
  .object({
    title: z.string().max(4000),
    details: z.string().max(40_000).nullable().optional(),
    plannedFor: plannedForSchema,
    calendarEvent: z
      .object({
        connectionId: z.string().min(1).max(200),
        calendarId: z.string().min(1).max(200),
        providerEventId: z.string().min(1).max(500),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

const planFenceSchema = z
  .object({
    planId: z.string().min(1).max(200),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

const createSchema = z.object({ draft: draftSchema }).strict();
const updateSchema = planFenceSchema.extend({ draft: draftSchema }).strict();

/**
 * Linking takes no version.
 *
 * A link neither reads nor replaces the Plan's own value, so two members linking
 * at the same moment produce two links rather than a conflict, and fencing them
 * against a version would refuse a member for a change that never touched what
 * they were doing.
 */
const linkSchema = z
  .object({
    planId: z.string().min(1).max(200),
    linkKind: householdEventPlanLinkKindSchema,
    recordId: z.string().min(1).max(200),
  })
  .strict();

const unlinkSchema = z
  .object({
    planId: z.string().min(1).max(200),
    linkId: z.string().min(1).max(200),
  })
  .strict();

type ParsedDraft = z.infer<typeof draftSchema>;

/**
 * A calendar day is stored at UTC midnight, matching how the surface formats it
 * back. The Plan's date is Tendnote-native planning content, so it is never
 * reconciled against the referenced provider event's own time zone.
 */
function draftFor(draft: ParsedDraft) {
  return {
    title: draft.title,
    details: draft.details ?? null,
    plannedFor: draft.plannedFor ? new Date(`${draft.plannedFor}T00:00:00.000Z`) : null,
    calendarEvent: draft.calendarEvent ?? null,
  };
}

const householdScope = (mutation: HouseholdEventPlanMutation, ownerUserId: string) =>
  mutation.outcome === "saved"
    ? ([
        {
          kind: "owner-collection" as const,
          collection: "household-planning" as const,
          ownerUserId,
        },
      ] as const)
    : ([] as const);

/**
 * Runs one material write and reports which of the two things happened.
 *
 * The conflict is caught here rather than left to throw because it is an answer
 * the member acts on, not an error: turning it into a generic failure would lose
 * the current value and the actor, which are the whole point of the contract.
 */
async function writePlan(
  callerUserId: string,
  write: () => Promise<unknown>,
): Promise<HouseholdEventPlanMutation> {
  try {
    await write();
  } catch (error) {
    if (error instanceof HouseholdEventPlanConflictError) {
      return { outcome: "conflict", message: error.message, current: error.current };
    }
    throw error;
  }
  return { outcome: "saved", plans: await readHouseholdEventPlans(callerUserId) };
}

/**
 * Creates a Plan, whether from explicit household intent or from a member
 * choosing "Plan this event" on a Household Calendar Event.
 *
 * Both routes are this one mutation, and a calendar event contributes only its
 * address: the title is always what a member typed, because a Plan seeded from
 * the provider's wording would be a mirror on the day it was made.
 */
export async function createHouseholdEventPlanAction(input: {
  draft: ParsedDraft;
}): Promise<HouseholdEventPlanResult> {
  return runOwnerAction({
    schema: createSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) =>
      writePlan(ownerUserId, () =>
        createHouseholdEventPlan({ callerUserId: ownerUserId, draft: draftFor(parsed.draft) }),
      ),
    affectedScopes: householdScope,
    result: (mutation) => mutation,
  });
}

/**
 * Edits a Plan against the version the member's screen was carrying.
 *
 * The draft always restates the Plan's calendar reference, because a write is a
 * whole new value rather than a patch - omitting it would quietly drop the
 * event a Plan refers to as a side effect of fixing a typo.
 */
export async function updateHouseholdEventPlanAction(input: {
  planId: string;
  expectedVersion: number;
  draft: ParsedDraft;
}): Promise<HouseholdEventPlanResult> {
  return runOwnerAction({
    schema: updateSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) =>
      writePlan(ownerUserId, () =>
        updateHouseholdEventPlan({
          callerUserId: ownerUserId,
          planId: parsed.planId,
          expectedVersion: parsed.expectedVersion,
          draft: draftFor(parsed.draft),
        }),
      ),
    affectedScopes: householdScope,
    result: (mutation) => mutation,
  });
}

/** Archive is a Plan's removal path; no member may permanently delete one. */
export async function archiveHouseholdEventPlanAction(input: {
  planId: string;
  expectedVersion: number;
}): Promise<HouseholdEventPlanResult> {
  return runOwnerAction({
    schema: planFenceSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) =>
      writePlan(ownerUserId, () =>
        archiveHouseholdEventPlan({
          callerUserId: ownerUserId,
          planId: parsed.planId,
          expectedVersion: parsed.expectedVersion,
        }),
      ),
    affectedScopes: householdScope,
    result: (mutation) => mutation,
  });
}

/** Brings an archived Plan back. The same authority archiving took. */
export async function restoreHouseholdEventPlanAction(input: {
  planId: string;
  expectedVersion: number;
}): Promise<HouseholdEventPlanResult> {
  return runOwnerAction({
    schema: planFenceSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) =>
      writePlan(ownerUserId, () =>
        restoreHouseholdEventPlan({
          callerUserId: ownerUserId,
          planId: parsed.planId,
          expectedVersion: parsed.expectedVersion,
        }),
      ),
    affectedScopes: householdScope,
    result: (mutation) => mutation,
  });
}

/**
 * Points a Plan at a record the member can already see.
 *
 * Two refusals are the lifecycle's and are deliberately not re-decided here: an
 * archived Plan takes no links, and a caller who may not update this Plan - or
 * may not read that record - gets the proof engine's one opaque sentence. Both
 * reach the member as `{ ok: false }` through the runner's curated-error path,
 * so a refusal is something the surface can render rather than something it has
 * to survive.
 *
 * A link is context and only context. Nothing here gives the linked record any
 * say over the Plan, and nothing about the Plan reaches back into it.
 */
export async function linkHouseholdEventPlanRecordAction(input: {
  planId: string;
  linkKind: HouseholdEventPlanLinkKind;
  recordId: string;
}): Promise<HouseholdEventPlanResult> {
  return runOwnerAction({
    schema: linkSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) =>
      writePlan(ownerUserId, () =>
        linkHouseholdEventPlanRecord({
          callerUserId: ownerUserId,
          planId: parsed.planId,
          linkKind: parsed.linkKind,
          recordId: parsed.recordId,
        }),
      ),
    affectedScopes: householdScope,
    result: (mutation) => mutation,
  });
}

/** Takes a link off a Plan. The record itself is untouched and stays where it is. */
export async function unlinkHouseholdEventPlanRecordAction(input: {
  planId: string;
  linkId: string;
}): Promise<HouseholdEventPlanResult> {
  return runOwnerAction({
    schema: unlinkSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) =>
      writePlan(ownerUserId, () =>
        unlinkHouseholdEventPlanRecord({
          callerUserId: ownerUserId,
          planId: parsed.planId,
          linkId: parsed.linkId,
        }),
      ),
    affectedScopes: householdScope,
    result: (mutation) => mutation,
  });
}
