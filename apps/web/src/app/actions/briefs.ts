"use server";

import {
  acceptBriefSuggestedFollowup,
  dismissBriefItem,
  generateManualBrief,
  snoozeBriefItem,
} from "@tendnote/db/queries/briefs";
import { briefCadenceSchema } from "@tendnote/domain";
import { z } from "zod";
import { currentLocalDate } from "@/lib/brief-local-date";
import { runOwnerAction } from "@/lib/owner-action";

// Default snooze defers a brief item by a week — long enough to clear it from the
// rail without losing the underlying relationship context (PRD #65).
const SNOOZE_DAYS = 7;

const generateBriefSchema = z.object({
  // Reuse the domain cadence enum so the action cannot drift from the model.
  cadence: briefCadenceSchema,
  // Explicit regeneration; defaults to false so a manual request returns the
  // existing current brief rather than silently replacing it (PRD #65).
  regenerate: z.boolean().optional(),
});

/**
 * Narrow owner-scoped manual generate/regenerate action for the current daily or
 * weekly brief (PRD #65, issue #69). It resolves the signed-in owner, calls the
 * shared audited manual seam (the same generator schedule dispatch uses), and
 * revalidates the dashboard so the rail reflects the new brief.
 */
export async function generateBriefAction(input: {
  cadence: "daily" | "weekly";
  regenerate?: boolean;
}) {
  return runOwnerAction({
    schema: generateBriefSchema,
    input,
    budget: { costCategory: "server-action" },
    body: ({ ownerUserId, input: { cadence, regenerate } }) =>
      generateManualBrief({
        ownerUserId,
        cadence,
        localDate: currentLocalDate(),
        regenerate,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({
      briefId: outcome.result.brief.id,
      cadence: outcome.result.brief.cadence,
      outcome: outcome.result.outcome,
    }),
  });
}

const briefItemActionSchema = z.object({ briefItemId: z.uuid() });

/**
 * Dismisses a brief item from the dashboard. Local to the brief surface — the
 * underlying memory, source record, and follow-up are untouched (PRD #65).
 */
export async function dismissBriefItemAction(input: { briefItemId: string }) {
  return runOwnerAction({
    schema: briefItemActionSchema,
    input,
    body: ({ ownerUserId, input: { briefItemId } }) =>
      dismissBriefItem({ ownerUserId, briefItemId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({
      briefItemId: outcome.result.id,
      status: outcome.result.status,
    }),
  });
}

/** Snoozes a brief item, deferring it without losing the underlying context. */
export async function snoozeBriefItemAction(input: { briefItemId: string }) {
  return runOwnerAction({
    schema: briefItemActionSchema,
    input,
    body: ({ ownerUserId, input: { briefItemId } }) =>
      snoozeBriefItem({
        ownerUserId,
        briefItemId,
        snoozedUntil: new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({
      briefItemId: outcome.result.id,
      status: outcome.result.status,
    }),
  });
}

/**
 * Accepts a suggested-followup brief item: it delegates to the existing
 * suggested-followup review mutation (the follow-up becomes a real reminder) and
 * marks the brief item acted-on only after that succeeds (PRD #65, issue #71). A
 * failure propagates so the rail keeps the item rather than hiding it.
 */
export async function acceptBriefFollowupAction(input: { briefItemId: string }) {
  return runOwnerAction({
    schema: briefItemActionSchema,
    input,
    body: ({ ownerUserId, input: { briefItemId } }) =>
      acceptBriefSuggestedFollowup({ ownerUserId, briefItemId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({
      briefItemId: outcome.result.briefItem.id,
      status: outcome.result.briefItem.status,
    }),
  });
}
