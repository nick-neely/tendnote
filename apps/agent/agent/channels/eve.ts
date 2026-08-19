import {
  checkAccess,
  createAdmissionResolver,
  grantAccess,
} from "@tendnote/db/queries/access-profiles";
import { eveChannel } from "eve/channels/eve";
import { getAgentAuth } from "../lib/auth-server";
import { createLocalOwnerAuth, createTendnoteSessionAuth } from "../lib/eve-auth";
import { getAgentRateLimiter } from "../lib/rate-limit";

const admission = createAdmissionResolver({
  accessProfiles: { checkAccess, grantAccess },
  // Eve's hosted boundary has no independent Flags targeting surface. Hosted
  // access is therefore persisted-first and fail-closed; Web persists any
  // successful Flags grant before both surfaces consume it.
  evaluateFlag: async () => false,
});

const hostedSessionAuth = createTendnoteSessionAuth({
  getSession: (headers) => getAgentAuth().api.getSession({ headers }),
  resolveAccess: (entity) => admission.resolveAccess(entity),
  checkIngressBudget: (userId) =>
    getAgentRateLimiter().check({ subject: userId, costCategory: "eve-ingress" }),
});

/**
 * Eve is a separate Vercel service in production, so route auth must terminate
 * here. Better Auth cookies are verified directly; only loopback development may
 * fall through to the explicit demo owner.
 */
export default eveChannel({ auth: [hostedSessionAuth, createLocalOwnerAuth()] });
