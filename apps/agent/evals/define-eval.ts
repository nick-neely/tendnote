import type { EveEvalInput, EveEvalSession } from "eve/evals";
import { defineEval as defineEveEval, type EveEvalContext, type EveEvalTurn } from "eve/evals";
import { approveToolApprovals } from "./helpers";

/**
 * `defineEval`, with the owner already in the room.
 *
 * Every durable write, egress, and restricted reveal now parks the turn until
 * the session owner answers (ADR 0237). An eval driving a raw `t.send` therefore
 * stops at `waiting` the moment the model reaches for a gated tool, and grades
 * half a turn: forty-eight of these files name a tool that is gated today, and
 * one of them had been taught to say `sendApproving`.
 *
 * That was the wrong default. What these evals are about is what Eve does once
 * allowed - the gate itself has deterministic policy tests where the policy
 * lives (ADR 0059, `tests/approval-policy.test.ts`) - so the harness plays the
 * owner who says yes, and does it for every eval rather than for the ones that
 * remembered to ask. {@link sendWithoutApproving} is kept as the explicit escape
 * hatch for an eval that has to observe the park itself, or drive a decline
 * through `respond`; no eval needs it yet.
 *
 * Only `t.send` is wrapped. `respond` is how an eval answers a request itself -
 * including a decline it means to make - so answering *for* it there would take
 * the decision back out of the eval's hands.
 */
export function defineEval(input: EveEvalInput) {
  return defineEveEval({
    ...input,
    test: (t) => input.test(autoApproving(t)),
  });
}

/**
 * `t.send`, without the standing approval: returns the turn exactly as the
 * agent left it, parked at `waiting` if a gated tool asked for the owner. For
 * the policy evals whose claim is that the call stopped and asked.
 */
export async function sendWithoutApproving(
  t: EveEvalContext,
  message: string,
): Promise<EveEvalTurn> {
  return await rawContext(t).send(message);
}

/** The proxy's own key for the context it wraps. */
const RAW_CONTEXT = Symbol("tendnote.evals.rawContext");

type Wrappable = EveEvalContext | EveEvalSession;

/**
 * The same context, with `send` answering any tool approval the turn parked on.
 *
 * A proxy rather than a spread copy: `EveEvalContext` is a live object whose
 * accessors (`events`, `reply`, `transcript`, `pendingInputRequests`) read the
 * session as it moves, so a snapshot taken at wrap time would be a stale one.
 * Reads are forwarded with the original as the receiver, and methods are bound
 * to it, so nothing inside eve sees the proxy at all.
 */
function autoApproving<T extends Wrappable>(context: T): T {
  return new Proxy(context, {
    get(target, property) {
      if (property === RAW_CONTEXT) return target;

      if (property === "send") {
        return async (
          message: Parameters<Wrappable["send"]>[0],
          options?: Parameters<Wrappable["send"]>[1],
        ) => await approveToolApprovals(target, await target.send(message, options));
      }
      // A second session is another place a gated call can park.
      if (property === "newSession" && "newSession" in target) {
        return () => autoApproving((target as EveEvalContext).newSession());
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function rawContext(t: EveEvalContext): EveEvalContext {
  return (t as { [RAW_CONTEXT]?: EveEvalContext })[RAW_CONTEXT] ?? t;
}
