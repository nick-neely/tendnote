/**
 * The one failure the Assistant has to name rather than apologise for: the
 * conversation's Eve session has ended.
 *
 * Eve sessions expire on an absolute clock (`limits.sessionTimeoutMs`, 30 days
 * by default). The durable stream survives — an old thread still lists, opens,
 * and replays — but the session stops accepting messages, and a follow-up comes
 * back `409 {"code":"session_not_active"}` (ADR 0238). That is not an outage and
 * must not be rendered as one: the transcript stays readable and the composer
 * goes away, because a composer that will always fail is a lie.
 *
 * The check is structural rather than an `instanceof ClientError`, for two
 * reasons. Eve's store hands `onError` whatever it caught, which may be a
 * wrapper around the HTTP failure; and the client bundle is external and pinned,
 * so binding this to a class identity would make a version bump silently
 * downgrade the ended state back into "The assistant is unavailable."
 */

/** The code eve's session route returns for an unknown or terminal session id. */
const SESSION_NOT_ACTIVE_CODE = "session_not_active";

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const held = (value as Record<string, unknown>)[key];
  return typeof held === "string" ? held : undefined;
}

/**
 * Whether this failure means "this conversation has ended", as opposed to
 * "something went wrong just now".
 *
 * `code` is eve's own stable answer and is checked first. The message and raw
 * body are checked after it because a rethrow, a `cause` chain, or a future
 * client that only carries text would otherwise read as a generic outage — and
 * being wrong in that direction leaves a dead composer on screen.
 */
export function isSessionNotActive(error: unknown): boolean {
  if (!error) return false;

  if (readString(error, "code") === SESSION_NOT_ACTIVE_CODE) return true;

  const body = readString(error, "body");
  if (body?.includes(SESSION_NOT_ACTIVE_CODE)) return true;

  const message = error instanceof Error ? error.message : readString(error, "message");
  if (message?.includes(SESSION_NOT_ACTIVE_CODE)) return true;

  // eve's own prose for the same 409, which is what an `Error` rebuilt from the
  // response body alone would carry.
  return message === "The session is no longer active.";
}
