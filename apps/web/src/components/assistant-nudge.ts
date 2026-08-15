/**
 * Prompt-nudge → Eve binding (#114), isolated from the assistant panel so it stays
 * unit-testable without the panel's server-only transitive imports.
 */

import {
  type SelectedPersonContext,
  selectedPersonClientContext,
} from "@/lib/eve/selected-person-context";

export type NudgePersonContext = SelectedPersonContext;

export type NudgeAgent = {
  status: string;
  send: (message: string, options?: { clientContext?: string }) => Promise<unknown>;
};

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
  agent.send(prompt, { clientContext: selectedPersonClientContext(context) }).catch(() => {});
  return true;
}
