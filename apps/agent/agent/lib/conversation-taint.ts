import { WEB_SOURCE_TOOLS, type WebSourceTool } from "@tendnote/domain/assistant-sources";
import { defineState } from "eve/context";

/**
 * Tainted Conversation: whether Untrusted Content has been read in this
 * conversation, and by what.
 *
 * ## Why the taint is derived rather than accumulated
 *
 * eve 0.47.7's step emitter excludes provider-executed tool calls from every
 * hook event, so `web_search` - the framework capability the web chat mode
 * offers - never produces a `tool.completed` a hook could catch. There is no
 * hook-based design that can see it at all. The message history can: a
 * provider-executed call still lands in `ctx.messages` as an assistant
 * `tool-call` part and its `tool-result`, and a dynamic resolver on
 * `step.started` receives that whole history.
 *
 * Deriving also makes a resumed conversation tainted exactly when it was, with
 * no separate persistence to keep in sync, and makes the scan idempotent: the
 * same history answers the same way however many steps run over it.
 *
 * The state slot is still needed. It is what the approval policy reads - the
 * policy has an `ApprovalContext`, not a message history - and it is what
 * `web_fetch` sets from inside its own `execute`, so a fetch already in flight
 * when the resolver last ran is caught before its result reaches the policy on
 * the next call.
 *
 * Nothing clears it. A new conversation is the only way out: there is no
 * reliable way to tell an owner "the untrusted text is gone" while it still sits
 * in the transcript (ADR-0240).
 */

/**
 * The tools that read Untrusted Content into a conversation.
 *
 * `web_search` is provider-executed and cannot be gated at all (the ADR-0237
 * residual); `web_fetch` is gated but its *result* is still an unknown page.
 * Content another active Household Member authored is deliberately absent: it is
 * governed by Household Authorization Proofs (ADR-0219), a different question.
 *
 * The same two names the Assistant's citation reader recognises, taken from it
 * rather than restated: a tool that reaches the open web produces a citation and
 * taints the conversation, and those cannot be allowed to disagree about which
 * tools those are.
 */
export const UNTRUSTED_CONTENT_TOOL_NAMES = WEB_SOURCE_TOOLS;

export type UntrustedContentToolName = WebSourceTool;

export type ConversationTaint = {
  readonly tainted: boolean;
  readonly source: UntrustedContentToolName | null;
};

const UNTAINTED: ConversationTaint = Object.freeze({ tainted: false, source: null });

/**
 * The session-scoped slot the approval policy reads and both taint writers set.
 *
 * `defineState` requires an active eve context (ALS scope). Every accessor below
 * is wrapped, because the readers include a policy that must never throw and the
 * writers include a tool that must not fail a fetch over an audit detail. The
 * slot itself stays module-private for that reason: those wrapped accessors are
 * the whole surface, and a caller reaching the raw slot would be the one that
 * throws.
 */
const conversationTaint = defineState<ConversationTaint>(
  "tendnote.conversation-taint",
  () => UNTAINTED,
);

/** The `toolName` on this message part, when it is one that reads Untrusted Content. */
function untrustedContentToolName(part: unknown): UntrustedContentToolName | null {
  if (typeof part !== "object" || part === null) return null;

  const { type, toolName } = part as { type?: unknown; toolName?: unknown };
  // An assistant `tool-call` part covers the provider-executed case, where the
  // call is recorded in the history but never reaches a hook; the `tool-result`
  // part covers a history compacted or replayed without its call.
  if (type !== "tool-call" && type !== "tool-result") return null;

  return UNTRUSTED_CONTENT_TOOL_NAMES.find((name) => name === toolName) ?? null;
}

/**
 * Whether this conversation history has read Untrusted Content, and what read it
 * first.
 *
 * Pure and total: a malformed message, a string content body, or a history that
 * is not an array answers "untainted" rather than throwing. The callers are a
 * dynamic resolver eve *skips* on a throw and an instruction that would lose the
 * whole turn's posture paragraph, so neither can afford an exception here.
 */
export function deriveConversationTaint(messages: unknown): ConversationTaint {
  try {
    if (!Array.isArray(messages)) return UNTAINTED;

    for (const message of messages) {
      const content = (message as { content?: unknown } | null | undefined)?.content;
      if (!Array.isArray(content)) continue;

      for (const part of content) {
        const source = untrustedContentToolName(part);
        if (source !== null) return { tainted: true, source };
      }
    }

    return UNTAINTED;
  } catch {
    return UNTAINTED;
  }
}

/**
 * Read the recorded taint, or `UNTAINTED` when there is no eve context to read.
 *
 * Failing to untainted is the only safe direction that is also honest: the
 * policy's fallback for an unreadable signal is to park, and an untainted answer
 * from here is what makes the mode and the Session Tool Trust decide instead.
 */
export function readConversationTaint(): ConversationTaint {
  try {
    return conversationTaint.get();
  } catch {
    return UNTAINTED;
  }
}

/**
 * Record that Untrusted Content was read. Idempotent, and the first source wins:
 * the question the owner asks is which conversation went untrusted, not which of
 * two web tools got there second.
 */
export function markConversationTainted(source: UntrustedContentToolName): void {
  try {
    conversationTaint.update((current) => (current.tainted ? current : { tainted: true, source }));
  } catch {
    // No active eve context. Nothing to record against, and nothing to fail.
  }
}

/**
 * Derive the taint from a conversation history and record it. The scan half of
 * the `step.started` resolver, kept here rather than in the tools file because
 * eve's bundler may hoist a `defineDynamic` handler.
 */
export function recordDerivedConversationTaint(messages: unknown): ConversationTaint {
  const derived = deriveConversationTaint(messages);
  if (derived.tainted && derived.source !== null) markConversationTainted(derived.source);
  return derived;
}

/**
 * The taint a caller holding both signals should believe: the recorded slot, or
 * the history, whichever has seen Untrusted Content.
 *
 * The dynamic instruction has a message history *and* runs where the slot may
 * not be readable; the two disagree only in the direction of a missed taint, so
 * either one saying "tainted" is the answer.
 */
export function resolveConversationTaint(messages: unknown): ConversationTaint {
  const recorded = readConversationTaint();
  if (recorded.tainted) return recorded;
  return deriveConversationTaint(messages);
}
