import type { AdmissionBlock } from "@tendnote/domain";
import { listAccountDeletionAdmissionBlocks } from "./account-deletion";
import { listSuspensionAdmissionBlocks } from "./temporary-suspensions";

/**
 * Every account-level admission block, each with the exceptions that name it
 * (ADR 0248): a pending deletion and an open Temporary Suspension. Refund and
 * dispute blocks belong to a subscription and are read with it instead. Web, Eve,
 * and household rosters all read blocks through this one reader, so a new
 * account-level block is added here once. Local reads only; never Stripe.
 */
export async function listAccountAdmissionBlocks(input: {
  userId: string;
}): Promise<AdmissionBlock[]> {
  const [deletion, suspension] = await Promise.all([
    listAccountDeletionAdmissionBlocks(input),
    listSuspensionAdmissionBlocks(input),
  ]);
  return [...deletion, ...suspension];
}
