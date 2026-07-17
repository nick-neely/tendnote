import { checkAccess } from "@tendnote/db/queries/access-profiles";
import { eveChannel } from "eve/channels/eve";
import { getAgentAuth } from "../lib/auth-server";
import { createLocalOwnerAuth, createTendnoteSessionAuth } from "../lib/eve-auth";
import { getAgentRateLimiter } from "../lib/rate-limit";

const hostedSessionAuth = createTendnoteSessionAuth({
  getSession: (headers) => getAgentAuth().api.getSession({ headers }),
  checkAccess: (userId) => checkAccess({ userId }),
  checkIngressBudget: (userId) =>
    getAgentRateLimiter().check({ subject: userId, costCategory: "eve-ingress" }),
});

/**
 * Eve is a separate Vercel service in production, so route auth must terminate
 * here. Better Auth cookies are verified directly; only loopback development may
 * fall through to the explicit demo owner.
 */
export default eveChannel({ auth: [hostedSessionAuth, createLocalOwnerAuth()] });
