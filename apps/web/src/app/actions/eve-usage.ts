"use server";

import { z } from "zod";
import { readEveUsageForDisplay } from "@/lib/assistant/eve-usage-display";
import { runOwnerAction } from "@/lib/owner-action";

/**
 * Interactive Eve's usage notice, re-read after each turn so a conversation
 * that crosses the Fair-Use Budget or the Account Ceiling says so before the
 * next turn (#626). `null` when it cannot be read; the panel keeps what it had.
 */
export async function readEveUsageAction() {
  return runOwnerAction({
    schema: z.undefined(),
    input: undefined,
    body: async ({ ownerUserId }) => (await readEveUsageForDisplay(ownerUserId)) ?? null,
    result: (usage) => usage,
  });
}
