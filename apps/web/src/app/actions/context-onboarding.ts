"use server";

import {
  completeSelfContextOnboarding,
  dismissSelfContextOnboarding,
} from "@tendnote/db/queries/access-profiles";
import type { SelfContextOnboardingState } from "@tendnote/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";
import type { OwnerActionResult } from "@/lib/owner-action-result";
import {
  createSelfContextFactActionForChannel,
  type SelfContextFactActionInput,
} from "@/lib/self-context-fact-action";

const emptyInputSchema = z.undefined();

export type SelfContextOnboardingActionResult = OwnerActionResult<SelfContextOnboardingState>;

export async function createOnboardingSelfContextFactAction(input: SelfContextFactActionInput) {
  return createSelfContextFactActionForChannel(input, "onboarding");
}

export async function completeSelfContextOnboardingAction(): Promise<SelfContextOnboardingActionResult> {
  const result = await runOwnerAction({
    schema: emptyInputSchema,
    input: undefined,
    body: ({ ownerUserId }) => completeSelfContextOnboarding({ userId: ownerUserId }),
    affectedScopes: (_state, ownerUserId) => [
      { kind: "owner-collection", collection: "account", ownerUserId },
    ],
    result: (state) => state,
  });
  if (result.ok) revalidatePath("/");
  return result;
}

export async function dismissSelfContextOnboardingAction(): Promise<SelfContextOnboardingActionResult> {
  const result = await runOwnerAction({
    schema: emptyInputSchema,
    input: undefined,
    body: ({ ownerUserId }) => dismissSelfContextOnboarding({ userId: ownerUserId }),
    affectedScopes: (_state, ownerUserId) => [
      { kind: "owner-collection", collection: "account", ownerUserId },
    ],
    result: (state) => state,
  });
  if (result.ok) revalidatePath("/");
  return result;
}
