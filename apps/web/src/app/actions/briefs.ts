"use server";

import { generateManualBrief, type ManualBriefOutcome } from "@tendnote/db/queries/briefs";
import { briefCadenceSchema } from "@tendnote/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
import { currentLocalDate } from "@/lib/brief-local-date";

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
