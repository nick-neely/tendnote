import {
  createAccessProfileQueries,
  createInMemoryAccessProfileStore,
} from "@tendnote/db/queries/access-profiles";
import type { AdmissionBlock } from "@tendnote/domain";
import { createTendnoteAdmissionAuth } from "../../../../agent/agent/lib/eve-auth";
import { createPrivateBetaAccessResolver } from "./resolve-access";

/**
 * Web and Eve over one shared Admission, wired the way production wires them.
 *
 * The whole point of the shared boundary is that neither surface has its own
 * copy of the decision, so a proof that builds the two halves separately can
 * pass while they disagree. Every admission proof builds them here instead.
 */

export type Admission = Parameters<typeof createPrivateBetaAccessResolver>[0];

export function createAdmissionPair(
  admission: Admission,
  user: { id: string; email: string; emailVerified?: boolean },
) {
  return {
    web: createPrivateBetaAccessResolver(admission),
    eve: createTendnoteAdmissionAuth({
      admission,
      getSession: async () => ({ user }),
      checkIngressBudget: async () => ({ allowed: true }),
    }),
  };
}

/**
 * The same pair over a fresh in-memory Access Profile store. `blocks` holds each
 * user's active admission blocks with the exception records that name them.
 */
export function createAdmissionHarness(input: {
  policy: Admission["policy"];
  evaluateFlag: Admission["evaluateFlag"];
  user: { id: string; email: string; emailVerified?: boolean };
  queries?: ReturnType<typeof createAccessProfileQueries>;
}) {
  const queries = input.queries ?? createAccessProfileQueries(createInMemoryAccessProfileStore());
  const blocks = new Map<string, readonly AdmissionBlock[]>();
  const admission: Admission = {
    accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
    evaluateFlag: input.evaluateFlag,
    listAdmissionBlocks: async ({ userId }) => blocks.get(userId) ?? [],
    policy: input.policy,
  };
  return { queries, blocks, admission, ...createAdmissionPair(admission, input.user) };
}
