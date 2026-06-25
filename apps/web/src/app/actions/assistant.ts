"use server";

import { z } from "zod";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
import { runWebChatTurn, type WebChatTurnResult } from "@/lib/eve/bridge";
import { createEveChatTransport } from "@/lib/eve/transport";

const submitAssistantTurnSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  // When the assistant is opened from a person profile, the resolved person
  // rides along so Eve links context without re-resolving identity (issue #21).
  personId: z.uuid().optional(),
  personName: z.string().trim().min(1).optional(),
});

export type SubmitAssistantTurnInput = z.input<typeof submitAssistantTurnSchema>;

/**
 * Server entry point for one web chat turn. Resolves the owner from the
 * authenticated session (local dev fallback included), then routes the turn
 * through the single Eve bridge seam. The web app holds no agent planning of
 * its own — Eve resolves intent and calls typed tools.
 */
export async function submitAssistantTurn(
  input: SubmitAssistantTurnInput,
): Promise<WebChatTurnResult> {
  const parsed = submitAssistantTurnSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();

  return runWebChatTurn(
    {
      ownerUserId,
      message: parsed.message,
      personContext:
        parsed.personId && parsed.personName
          ? { personId: parsed.personId, personName: parsed.personName }
          : undefined,
    },
    createEveChatTransport(),
  );
}
