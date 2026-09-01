import type { AssistantTurnUnit } from "@/lib/eve/message-views";

/**
 * Stable React key for one turn render unit.
 *
 * A turn's units are rebuilt from `message.parts` on every streamed token, so the key
 * is what decides whether React re-uses a mounted card or throws it away and mounts a
 * fresh one. Three properties are load-bearing, and each is a real failure if lost:
 *
 * - **A group is distinct from a lone result of the same kind.** A group keys off its
 *   kind *and* its first member, so folding six saved memories into one summary does
 *   not collide with a seventh that renders on its own.
 * - **A parked call and its settled status share a key.** They are the same part in
 *   two states, so `ChatApprovalCard` is *replaced* by `ChatApprovalStatus` in place
 *   rather than the slot unmounting and a new one animating in beneath it.
 * - **Everything else keys off its own `toolCallId`,** which eve guarantees unique per
 *   call, so a card never inherits the open/closed state of the card that preceded it.
 *
 * It lives here, beside the {@link AssistantTurnUnit} union it is a total function of,
 * rather than in the renderer: nothing about it needs React, and as plain TypeScript
 * every branch is provable by a unit test instead of only through a mounted panel.
 */
export function turnUnitKey(messageId: string, unit: AssistantTurnUnit): string {
  switch (unit.type) {
    case "group":
      return `${messageId}:group:${unit.kind}:${unit.entries[0].toolCallId}`;
    case "single":
      return `${messageId}:${unit.entry.toolCallId}`;
    case "request":
      return `${messageId}:${unit.request.toolCallId}`;
    case "resolution":
      return `${messageId}:${unit.resolution.toolCallId}`;
    default:
      return `${messageId}:${unit.active.toolCallId}`;
  }
}
