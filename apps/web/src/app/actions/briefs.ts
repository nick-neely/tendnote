"use server";

import {
  dismissBriefItem,
  generateManualBrief,
  type ManualBriefOutcome,
  snoozeBriefItem,
} from "@tendnote/db/queries/briefs";
import { briefCadenceSchema } from "@tendnote/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
import { currentLocalDate } from "@/lib/brief-local-date";

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

export type GenerateBriefResult = {
  briefId: string;
  cadence: "daily" | "weekly";
  outcome: ManualBriefOutcome;
};

/**
 * Narrow owner-scoped manual generate/regenerate action for the current daily or
 * weekly brief (PRD #65, issue #69). It resolves the signed-in owner, calls the
 * shared audited manual seam (the same generator schedule dispatch uses), and
 * revalidates the dashboard so the rail reflects the new brief.
 */
export async function generateBriefAction(input: {
  cadence: "daily" | "weekly";
  regenerate?: boolean;
}): Promise<GenerateBriefResult> {
  const { cadence, regenerate } = generateBriefSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();

  const result = await generateManualBrief({
    ownerUserId,
    cadence,
    localDate: currentLocalDate(),
    regenerate,
  });

  revalidatePath("/");

  return { briefId: result.brief.id, cadence, outcome: result.outcome };
}

const briefItemActionSchema = z.object({ briefItemId: z.uuid() });

export type BriefItemResolution = { briefItemId: string; status: string };

/**
 * Dismisses a brief item from the dashboard. Local to the brief surface — the
 * underlying memory, source record, and follow-up are untouched (PRD #65).
 */
export async function dismissBriefItemAction(input: {
  briefItemId: string;
}): Promise<BriefItemResolution> {
  const { briefItemId } = briefItemActionSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const item = await dismissBriefItem({ ownerUserId, briefItemId });

  revalidatePath("/");
  return { briefItemId: item.id, status: item.status };
}

/** Snoozes a brief item, deferring it without losing the underlying context. */
export async function snoozeBriefItemAction(input: {
  briefItemId: string;
}): Promise<BriefItemResolution> {
  const { briefItemId } = briefItemActionSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const snoozedUntil = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000);
  const item = await snoozeBriefItem({ ownerUserId, briefItemId, snoozedUntil });

  revalidatePath("/");
  return { briefItemId: item.id, status: item.status };
}
