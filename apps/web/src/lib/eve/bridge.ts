/**
 * Web → Eve chat bridge seam.
 *
 * The web assistant submits one chat turn through {@link runWebChatTurn}, which
 * forwards the owner-scoped message to Eve via an injectable {@link EveChatTransport}
 * and reduces Eve's turn into a structured {@link WebChatTurnResult} the UI can
 * render. The bridge owns no agent planning: Eve resolves intent and calls typed
 * tools; the bridge only carries the turn across the boundary and shapes the reply.
 *
 * Keeping the transport injectable lets the conversation-to-bridge-to-response
 * seam be tested deterministically without running a model (ADR 0059: policy
 * tests before model evals).
 */

/** How a single Eve turn ended, mirrored from the eve client `MessageResult`. */
export type WebChatTurnStatus = "completed" | "waiting" | "failed";

/** JSON value the transport may forward as turn client context. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** A persisted tool result Eve surfaced during the turn. */
export type WebChatToolResult = {
  readonly toolName: string;
  readonly output: unknown;
};

/** One chat turn the web assistant asks Eve to handle. */
export type WebChatTurnRequest = {
  readonly ownerUserId: string;
  readonly message: string;
  /**
   * When the assistant is opened from a person profile, the resolved person is
   * passed along so Eve links context to them without re-resolving identity.
   */
  readonly personContext?: {
    readonly personId: string;
    readonly personName: string;
  };
};

/** Structured result the web UI renders for one chat turn. */
export type WebChatTurnResult = {
  readonly status: WebChatTurnStatus;
  readonly assistantText: string | null;
  readonly toolResults: readonly WebChatToolResult[];
  readonly sessionId: string | null;
};

/** Owner-scoped turn payload handed to the transport. */
export type EveTurnTransportInput = {
  readonly ownerUserId: string;
  readonly message: string;
  readonly clientContext?: JsonObject;
};

/** Transport-level result of one Eve turn, already reduced from the event stream. */
export type EveTurnTransportResult = {
  readonly status: WebChatTurnStatus;
  readonly message: string | undefined;
  readonly sessionId: string;
  readonly toolResults: readonly WebChatToolResult[];
};

/**
 * The single seam between the web app and the Eve runtime. The default
 * implementation talks to the eve channel over HTTP; tests inject a fake.
 */
export interface EveChatTransport {
  sendTurn(input: EveTurnTransportInput): Promise<EveTurnTransportResult>;
}

export async function runWebChatTurn(
  request: WebChatTurnRequest,
  transport: EveChatTransport,
): Promise<WebChatTurnResult> {
  const turn = await transport.sendTurn({
    ownerUserId: request.ownerUserId,
    message: request.message,
    clientContext: request.personContext
      ? {
          person: {
            id: request.personContext.personId,
            displayName: request.personContext.personName,
          },
        }
      : undefined,
  });

  const assistantText =
    turn.message ??
    (turn.status === "failed"
      ? "I couldn't finish that. Check the local services and try again."
      : null);

  return {
    status: turn.status,
    assistantText,
    toolResults: turn.toolResults,
    sessionId: turn.sessionId,
  };
}
