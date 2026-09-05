import { defineDynamic } from "eve/tools";
import { recordDerivedConversationTaint } from "../lib/conversation-taint";

/**
 * The Tainted Conversation scanner: the file that makes ADR-0240's taint real.
 *
 * It authors no tool. Like `eve_mode_gate.ts`, it is a `defineDynamic` resolver
 * in the tools slot - the only place eve runs authored code on `step.started`
 * with the conversation history in hand - and it always returns `null`, so it
 * contributes nothing to the model's surface.
 *
 * ## Why `step.started` and why the history
 *
 * eve 0.47.7's step emitter excludes provider-executed tool calls from every
 * hook event, so `web_search` never produces an event a hook could subscribe to.
 * A `step.started` resolver has no such blind spot: `ctx.messages` is the full
 * history assembled so far, provider-executed turns included, and it runs inside
 * eve's context scope, so the state slot the approval policy reads is writable
 * from here. `web_fetch` sets the same slot inside its own `execute`, which
 * covers the one gap left - a fetch that completes after this resolver last ran.
 *
 * ## Why nothing in here is allowed to throw
 *
 * eve *skips* a dynamic resolver that throws. For the mode gate that means
 * failing open on the tool surface; here it would mean failing open on the
 * taint, letting a `trusted` conversation keep auto-approving after it had read
 * a page. The scan is total by construction (`deriveConversationTaint` answers
 * "untainted" for any shape it does not understand) and the recording swallows a
 * missing context, so this handler has no throwing path at all.
 */
export default defineDynamic({
  events: {
    "step.started": (_event, ctx) => {
      // Optional on purpose, the way the mode gate reads its session: a context
      // arriving without the history is the shape this must not throw on, and
      // `deriveConversationTaint` already answers "untainted" for `undefined`.
      recordDerivedConversationTaint((ctx as { messages?: unknown } | undefined)?.messages);
      // Contributes no tool. The taint is the whole output, and it is recorded
      // in the state slot rather than returned.
      return null;
    },
  },
});
