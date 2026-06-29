/**
 * Prompt-nudge → Eve binding (#114), isolated from the assistant panel so it stays
 * unit-testable without the panel's server-only transitive imports.
 */

export type NudgePersonContext = { personId: string; personName: string };

type NudgeClientContext = { person: { id: string; displayName: string } } | undefined;

export type NudgeAgent = {
  status: string;
  send: (input: { message: string; clientContext?: NudgeClientContext }) => Promise<unknown>;
};

/** Owner-safe one-turn client context for the agent, or none when unscoped. */
export function nudgeClientContextFor(context?: NudgePersonContext): NudgeClientContext {
  return context
    ? { person: { id: context.personId, displayName: context.personName } }
    : undefined;
}

/**
 * Send a prompt nudge to Eve: only when the agent is ready, the nudge's full prompt
 * text is sent as a normal turn. It never mutates product state or accepts/dismisses
 * a suggestion. Returns whether a send was started.
 */
export function sendNudgeToAgent(
  agent: NudgeAgent,
  context: NudgePersonContext | undefined,
  prompt: string,
): boolean {
  if (agent.status !== "ready") {
    return false;
  }
  agent.send({ message: prompt, clientContext: nudgeClientContextFor(context) }).catch(() => {});
  return true;
}
