"use server";

import {
  acceptHouseholdOwnerRole,
  cancelHouseholdDissolution,
  confirmHouseholdDissolution,
  declineHouseholdOwnerRole,
  getHouseholdOverviewForUser,
  type HouseholdDissolutionState,
  leaveHousehold,
  offerHouseholdOwnerRole,
  removeHouseholdMember,
  stepDownFromHouseholdOwner,
  withdrawHouseholdOwnerOffer,
} from "@tendnote/db/queries/households";
import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { z } from "zod";
import type { OwnerActionResult } from "@/lib/owner-action";
import { runOwnerAction } from "@/lib/owner-action";

/**
 * Every governance action answers with the whole refreshed Overview rather than
 * the row it touched.
 *
 * Governance moves change more than their target: promoting someone changes who
 * can be removed, a departure can unblock the last-owner rule, and a removal
 * frees a seat. Returning one row would leave the surface recomputing capacity
 * and availability it does not own — and the availability answers are exactly
 * the ones that must not be guessed at.
 */
type OverviewResult = OwnerActionResult<HouseholdOverview>;

/**
 * The end of a household has no Overview to return to, so it answers with what
 * happened instead: `dissolution.dissolved` is non-null only once every active
 * Owner has confirmed, and it carries the date the recovery window closes.
 */
export type HouseholdDissolutionResult = OwnerActionResult<{
  dissolution: HouseholdDissolutionState;
  view: HouseholdOverview | null;
}>;

const memberSchema = z.object({ memberUserId: z.string().min(1).max(200) }).strict();
const emptySchema = z.object({}).strict();
const dissolutionConfirmSchema = z.object({ endsNow: z.boolean() }).strict();

async function overviewFor(userId: string): Promise<HouseholdOverview> {
  const overview = await getHouseholdOverviewForUser({ userId });
  if (!overview) {
    throw new Error("Household overview unavailable.");
  }
  return overview;
}

const accountScope = (_result: unknown, ownerUserId: string) =>
  [{ kind: "owner-collection" as const, collection: "account" as const, ownerUserId }] as const;

/**
 * Offers co-ownership. It grants nothing: the recipient's own acceptance is what
 * changes a role, and until then the offer is a question their Household screen
 * asks them (ADR 0213).
 */
export async function offerHouseholdOwnerRoleAction(input: {
  memberUserId: string;
}): Promise<OverviewResult> {
  return runOwnerAction({
    schema: memberSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) => {
      await offerHouseholdOwnerRole({
        actorUserId: ownerUserId,
        memberUserId: parsed.memberUserId,
      });
      return overviewFor(ownerUserId);
    },
    affectedScopes: accountScope,
    result: (overview) => overview,
  });
}

/** Takes an unanswered offer back. */
export async function withdrawHouseholdOwnerOfferAction(input: {
  memberUserId: string;
}): Promise<OverviewResult> {
  return runOwnerAction({
    schema: memberSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) => {
      await withdrawHouseholdOwnerOffer({
        actorUserId: ownerUserId,
        memberUserId: parsed.memberUserId,
      });
      return overviewFor(ownerUserId);
    },
    affectedScopes: accountScope,
    result: (overview) => overview,
  });
}

/** The recipient's own yes. It takes no member id — it can only be about them. */
export async function acceptHouseholdOwnerRoleAction(): Promise<OverviewResult> {
  return runOwnerAction({
    schema: emptySchema,
    input: {},
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId }) => {
      await acceptHouseholdOwnerRole({ userId: ownerUserId });
      return overviewFor(ownerUserId);
    },
    affectedScopes: accountScope,
    result: (overview) => overview,
  });
}

/** Their own no. It changes nothing, and the offer can be made again later. */
export async function declineHouseholdOwnerRoleAction(): Promise<OverviewResult> {
  return runOwnerAction({
    schema: emptySchema,
    input: {},
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId }) => {
      await declineHouseholdOwnerRole({ userId: ownerUserId });
      return overviewFor(ownerUserId);
    },
    affectedScopes: accountScope,
    result: (overview) => overview,
  });
}

/** An Owner stepping back to member, which only they can do to themselves. */
export async function stepDownFromHouseholdOwnerAction(): Promise<OverviewResult> {
  return runOwnerAction({
    schema: emptySchema,
    input: {},
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId }) => {
      await stepDownFromHouseholdOwner({ userId: ownerUserId });
      return overviewFor(ownerUserId);
    },
    affectedScopes: accountScope,
    result: (overview) => overview,
  });
}

/**
 * Removes one member. The protected-co-owner rule is re-decided in the shared
 * lifecycle, so a stale client that still shows the control on an Owner's row
 * gets the same curated refusal the row itself would have explained.
 */
export async function removeHouseholdMemberAction(input: {
  memberUserId: string;
}): Promise<OverviewResult> {
  return runOwnerAction({
    schema: memberSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) => {
      await removeHouseholdMember({ actorUserId: ownerUserId, memberUserId: parsed.memberUserId });
      return overviewFor(ownerUserId);
    },
    affectedScopes: accountScope,
    result: (overview) => overview,
  });
}

/**
 * Voluntary departure. It answers with `view: null` because after it there is no
 * household to describe — the caller's own membership is what the Overview is
 * read through.
 */
export async function leaveHouseholdAction(): Promise<
  OwnerActionResult<{ view: HouseholdOverview | null }>
> {
  return runOwnerAction({
    schema: emptySchema,
    input: {},
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId }) => {
      await leaveHousehold({ userId: ownerUserId });
      return { view: await getHouseholdOverviewForUser({ userId: ownerUserId }) };
    },
    affectedScopes: accountScope,
    result: (result) => result,
  });
}

/**
 * Records this Owner's agreement that the household should end, and ends it the
 * moment every active Owner has agreed.
 *
 * Until then the answer is a refreshed Overview showing how many owners are
 * still to confirm, so the decision is visible to all of them rather than being
 * a private countdown held by whoever started it.
 *
 * `endsNow` carries what the pressed control said it would do. The lifecycle
 * declines a press offered as an ordinary agreement that turns out to be the
 * last one needed, so an Overview a moment out of date cannot end a household
 * on someone who was told nothing would change yet.
 */
export async function confirmHouseholdDissolutionAction(input: {
  endsNow: boolean;
}): Promise<HouseholdDissolutionResult> {
  return runOwnerAction({
    schema: dissolutionConfirmSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) => {
      const dissolution = await confirmHouseholdDissolution({
        ownerUserId,
        endsNow: parsed.endsNow,
      });
      return { dissolution, view: await getHouseholdOverviewForUser({ userId: ownerUserId }) };
    },
    affectedScopes: accountScope,
    result: (result) => result,
  });
}

/** Calls the ending off. One Owner withdrawing is enough. */
export async function cancelHouseholdDissolutionAction(): Promise<HouseholdDissolutionResult> {
  return runOwnerAction({
    schema: emptySchema,
    input: {},
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId }) => {
      const dissolution = await cancelHouseholdDissolution({ ownerUserId });
      return { dissolution, view: await getHouseholdOverviewForUser({ userId: ownerUserId }) };
    },
    affectedScopes: accountScope,
    result: (result) => result,
  });
}
