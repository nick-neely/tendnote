import { ClientError } from "eve/client";
import type { EveEvalLiveTurn, EveEvalSession } from "eve/evals";
import { approveToolApprovals } from "../helpers";

// A failed first stream read is not permission to POST the message again.
// Only recover an acknowledged session whose stream has yielded no events.
export async function sendReplayTurn(
  session: EveEvalSession,
  message: string,
  watch: (id: string) => EveEvalLiveTurn,
  options?: Parameters<EveEvalSession["send"]>[1],
) {
  try {
    return {
      session,
      turn: await approveToolApprovals(session, await session.send(message, options)),
    };
  } catch (error) {
    if (
      !(error instanceof ClientError) ||
      error.status !== 404 ||
      !session.sessionId ||
      session.state?.streamIndex !== 0 ||
      session.events.length !== 0
    )
      throw error;
    const live = watch(session.sessionId);
    return {
      session: live.session,
      turn: await approveToolApprovals(live.session, await live.result()),
    };
  }
}
