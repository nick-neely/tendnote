"use server";

import {
  type ApprovalSubjectLookup,
  describeApprovalSubject,
} from "@tendnote/db/queries/approval-subjects";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";

/**
 * What the owner is actually being asked to authorize, for a tool call Eve parked.
 *
 * eve 0.47.7 freezes the tool input onto its approval request and renders nothing
 * else, so an id-referenced write reaches the approval card as a UUID and a tool
 * name. The agent-side policy resolves the same record, but its summary never
 * reaches the browser — eve drops it — so the card has to ask for one itself.
 *
 * Two things make that safe to expose as a Server Action:
 *
 * - **The owner comes from the session, never from the request.** `runOwnerAction`
 *   gates on `requireAdmittedOwnerForAction` before a single field is read, and the
 *   registry is handed that id. A caller cannot describe somebody else's record by
 *   naming their id, because the id it supplies is only ever the *record's*.
 * - **A record that does not resolve is `missing`,** the same answer as "no such
 *   record" and "that input did not parse". The registry never distinguishes them,
 *   so this action is not an existence oracle for another household's data
 *   (ADR 0219).
 *
 * It reads and never writes: no affected scopes, no cache reconciliation, no budget.
 */

/** Long enough for every authored tool name, short enough to stop a runaway string. */
const TOOL_NAME_MAX_LENGTH = 120;

const describeApprovalSubjectSchema = z.object({
  toolName: z.string().trim().min(1).max(TOOL_NAME_MAX_LENGTH),
  /**
   * The frozen tool input, exactly as the parked call carries it. Only its
   * *shape* is checked here — it has to be plain JSON, because it crossed the
   * wire from a model-authored call — and the registry's per-tool schema is the
   * real gate on its contents.
   */
  input: z.json().optional(),
});

export async function describeApprovalSubjectAction(request: {
  toolName: string;
  input?: unknown;
}) {
  return runOwnerAction({
    schema: describeApprovalSubjectSchema,
    input: request,
    body: ({ ownerUserId, input: parsed }): Promise<ApprovalSubjectLookup> =>
      describeApprovalSubject({
        ownerUserId,
        toolName: parsed.toolName,
        input: parsed.input,
      }),
    result: (lookup) => lookup,
  });
}
