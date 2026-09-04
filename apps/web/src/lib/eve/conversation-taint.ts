import type { EveMessage } from "eve/react";

/**
 * Which parked calls in a conversation come *after* web content was read.
 *
 * A Tainted Conversation is one in which Untrusted Content — today a fetched page
 * or a web search result — has been read. From that point Eve's policy behaves as
 * `ask` Approval Mode whatever the owner chose, so an owner in `trusted` mode sees
 * an approval card they were not expecting and deserves to be told why.
 *
 * This is the *client's* reading of the same fact, and it is deliberately only an
 * explanation: the authoritative derivation runs inside the agent, on the message
 * history the model actually saw, and nothing here changes what a card sends. A
 * client that disagreed would show a wrong sentence, never a wrong decision.
 *
 * The rule matches the agent's: any `web_search` or `web_fetch` part counts,
 * whatever state it reached. A denied or errored fetch still put a URL through the
 * turn, and the two derivations have to agree on the same simple thing rather than
 * each guessing at "was it really read".
 */

/**
 * The two tools that reach the open web. Mirrors `WEB_SOURCE_TOOLS` in
 * `@tendnote/domain/assistant-sources`, which is private to that module; the set is
 * two literals and duplicating them is cheaper than widening that module's surface
 * for a projection that only the transcript needs.
 */
const WEB_TOOL_NAMES: ReadonlySet<string> = new Set(["web_fetch", "web_search"]);

/**
 * Every tool call in the conversation that a web tool part precedes, by call id.
 *
 * Order is transcript order — messages, then parts within a message — which is the
 * order the turn happened in, so "before" means what it says. A web part never
 * taints itself: the page has not been read at the moment the fetch is asked about.
 */
export function webTaintedToolCallIds(messages: readonly EveMessage[]): ReadonlySet<string> {
  const tainted = new Set<string>();
  let readWeb = false;

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "dynamic-tool") {
        continue;
      }
      if (readWeb) {
        tainted.add(part.toolCallId);
      }
      if (WEB_TOOL_NAMES.has(part.toolName)) {
        readWeb = true;
      }
    }
  }

  return tainted;
}
