import type { AuthFn } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * Header the web app injects the authenticated owner on. The agent is served
 * same-origin via `withEve()`, and `apps/web/src/middleware.ts` validates the
 * Better Auth session and sets this header (stripping any client value) before
 * the request reaches the channel, so the Eve session scopes every tool to the
 * owner the web app authorized (ADR 0001: shared owner-scoped mutations).
 */
const OWNER_HEADER = "x-tendnote-owner-id";

const localDemoOwnerUserId = "demo-user";

/**
 * Maps the server-set owner header onto the Eve session principal. The header is
 * always set by the web middleware (the only ingress), so it is trusted and not
 * forgeable by the browser. When absent it falls back to the same dev owner the
 * web app and tools use, keeping local owner scoping identical across surfaces.
 */
function bridgeOwnerAuth(): AuthFn<Request> {
  return (request) => {
    const ownerUserId =
      request.headers.get(OWNER_HEADER)?.trim() ||
      process.env.TENDNOTE_DEV_OWNER_USER_ID ||
      localDemoOwnerUserId;

    return {
      attributes: {},
      authenticator: "tendnote-web-bridge",
      principalId: ownerUserId,
      principalType: "user",
    };
  };
}

/**
 * Default Eve HTTP channel: the single same-origin ingress the web app's browser
 * streams turns to (via withEve). The owner-forwarding auth always resolves a
 * principal (the proxy-injected owner, or the local dev fallback), so the local
 * dev server stays reachable without a separate anonymous entry.
 */
export default eveChannel({ auth: bridgeOwnerAuth() });
