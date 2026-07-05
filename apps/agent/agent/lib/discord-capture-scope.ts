import type { PrivacyScope } from "@tendnote/domain";

/**
 * Discord-derived context a future author might be tempted to map onto a
 * household or shared visibility scope. Every field here is deliberately
 * *ignored* when deciding scope: guild, channel, and bot-install membership
 * never grant household or shared write/read authority (ADR-0132, ADR-0139).
 * They are accepted only so the decision seam can be documented and tested to
 * prove they change nothing.
 *
 * `requestedScope` is the single signal that can alter the outcome, and the
 * only change it can produce is a rejection: Discord may not opt a capture into
 * a non-private scope until an explicit household-capture product with its own
 * approval semantics exists.
 */
export type DiscordCaptureScopeContext = {
  /** Discord guild the interaction arrived from. Never grants household scope. */
  guildId?: string | null;
  /** Discord channel the interaction arrived from. Never grants shared scope. */
  channelId?: string | null;
  /**
   * An explicit visibility scope, should a future surface ever plumb one
   * through a Discord interaction. Anything other than `private` fails closed.
   */
  requestedScope?: PrivacyScope;
};

export type DiscordCaptureScopeDecision =
  | { type: "private" }
  | { type: "rejected"; reason: "household_scope_not_supported" };

/**
 * Deterministically gate the visibility scope for a Discord capture.
 *
 * Discord capture is always private, owner-scoped context. Household or shared
 * visibility must come from an explicit in-product visibility choice, never
 * from where a Discord message happened to originate. Guild and channel context
 * are read only to be ignored, and can never widen scope; the sole non-private
 * path is a fail-closed rejection of an explicit non-private request.
 *
 * This is the fail-closed gate and documented contract, not the enforcement of
 * privacy itself: the actual private guarantee is the DB capture path, which
 * hardcodes `scope: "private"` for every Source Record (ADR-0140). A `private`
 * decision therefore carries no scope payload — it only tells the caller the
 * write may proceed down that already-private path.
 */
export function resolveDiscordCaptureScope(
  context: DiscordCaptureScopeContext = {},
): DiscordCaptureScopeDecision {
  if (context.requestedScope && context.requestedScope !== "private") {
    return { type: "rejected", reason: "household_scope_not_supported" };
  }

  return { type: "private" };
}
