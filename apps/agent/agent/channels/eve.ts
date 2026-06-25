import type { AuthFn } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * Header the web bridge forwards the authenticated owner on. The web app
 * resolves the owner from its session (or the local dev fallback) and sets it
 * server-side, so the Eve session scopes every tool to the same owner the web
 * app already authorized (ADR 0001: shared owner-scoped mutations).
 */
const OWNER_HEADER = "x-tendnote-owner-id";

const localDemoOwnerUserId = "demo-user";

/**
 * Maps the bridge's forwarded owner onto the Eve session principal. When the
 * header is absent it falls back to the same dev owner the web app and tools
 * use, keeping local owner scoping identical across surfaces. This trusts a
 * server-set header from the internal web bridge; it is not a public ingress.
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
 * Default Eve HTTP channel: the single ingress the web chat bridge posts a turn
 * to. The owner-forwarding auth always resolves a principal (forwarded owner, or
 * the local dev fallback), so the local dev server stays reachable without a
 * separate anonymous entry.
 */
export default eveChannel({ auth: bridgeOwnerAuth() });
