import { checkAccess, grantAccess } from "@tendnote/db/queries/access-profiles";
import { getEveSessionOwnerUserId } from "@tendnote/db/queries/eve-session-owners";
import { eveChannel } from "eve/channels/eve";
import { getAgentAuth } from "../lib/auth-server";
import {
  createLocalOwnerAuth,
  createSessionOwnershipGuard,
  createTendnoteAdmissionAuth,
} from "../lib/eve-auth";
import { getAgentRateLimiter } from "../lib/rate-limit";

const hostedSessionAuth = createTendnoteAdmissionAuth({
  admission: {
    accessProfiles: { checkAccess, grantAccess },
    // Eve's hosted boundary has no independent Flags targeting surface. Hosted
    // access is therefore persisted-first and fail-closed; Web persists any
    // successful Flags grant before both surfaces consume it.
    evaluateFlag: async () => false,
  },
  getSession: (headers) => getAgentAuth().api.getSession({ headers }),
  checkIngressBudget: (userId) =>
    getAgentRateLimiter().check({ subject: userId, costCategory: "eve-ingress" }),
});

/**
 * Eve is a separate Vercel service in production, so route auth must terminate
 * here. Better Auth cookies are verified directly; only loopback development may
 * fall through to the explicit demo owner.
 *
 * Authentication alone does not authorize a session: Eve attaches to whatever
 * session id a route carries regardless of who created it. The ownership guard
 * wraps the whole auth policy so every session-ID-addressed route (follow-up,
 * stream, cancel, compact, clear, reset) is checked against the durable
 * session -> owner binding, and a foreign or unknown session fails closed with
 * an opaque 404. The binding itself is written by the `session.started` hook.
 */
export default eveChannel({
  auth: createSessionOwnershipGuard({
    auth: [hostedSessionAuth, createLocalOwnerAuth()],
    getOwnerUserId: getEveSessionOwnerUserId,
  }),
});
