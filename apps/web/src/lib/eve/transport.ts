import "server-only";

import { Client, defaultMessageReducer } from "eve/client";
import type {
  EveChatTransport,
  EveTurnTransportInput,
  EveTurnTransportResult,
  WebChatTurnStatus,
} from "./bridge";
import { collectToolResults } from "./tool-results";

/**
 * Header the bridge uses to forward the authenticated owner to the Eve channel.
 * The Eve `eveChannel` ingress maps it onto the session principal so every tool
 * scopes its reads and writes to the same owner the web app resolved (ADR 0001).
 */
export const OWNER_HEADER = "x-tendnote-owner-id";

/**
 * Base URL of the running Eve service (the `eve dev` / `eve build` server). The
 * conversational loop is the only feature that needs it; the deterministic
 * capture path never reaches Eve, so this stays optional until a turn runs.
 */
function resolveEveHost(): string {
  const host = process.env.TENDNOTE_EVE_URL?.trim();

  if (!host) {
    throw new Error(
      "TENDNOTE_EVE_URL is not set. Point it at the running Eve service (e.g. the URL printed by `pnpm dev:agent`) to use web chat.",
    );
  }

  return host;
}

/**
 * Default {@link EveChatTransport}: sends one turn to the Eve channel over HTTP,
 * forwarding the owner principal, and reduces the streamed events into the
 * structured turn result the bridge expects.
 */
export function createEveChatTransport(): EveChatTransport {
  return {
    async sendTurn(input: EveTurnTransportInput): Promise<EveTurnTransportResult> {
      const client = new Client({
        host: resolveEveHost(),
        headers: { [OWNER_HEADER]: input.ownerUserId },
      });

      const session = client.session();
      const response = await session.send({
        message: input.message,
        clientContext: input.clientContext,
      });
      const result = await response.result();

      const reducer = defaultMessageReducer();
      let data = reducer.initial();
      for (const event of result.events) {
        data = reducer.reduce(data, event);
      }

      return {
        status: result.status as WebChatTurnStatus,
        message: result.message,
        sessionId: result.sessionId,
        toolResults: collectToolResults(data),
      };
    },
  };
}
