"use server";

import { setTelemetryOptedOut } from "@tendnote/db/queries/account-telemetry";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";

const setTelemetryOptOutSchema = z.object({ optedOut: z.boolean() });

/**
 * Switch this account's optional telemetry off or back on: account funnel
 * events and third-party error reporting together, as one setting.
 *
 * The owner comes from `runOwnerAction`'s admission gate, never the request,
 * so no argument can name another account. No affected scopes: every collector
 * reads the setting fresh inside its own write.
 */
export async function setTelemetryOptOutAction(input: { optedOut: boolean }) {
  return runOwnerAction({
    schema: setTelemetryOptOutSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => ({
      optedOut: await setTelemetryOptedOut({ userId: ownerUserId, optedOut: parsed.optedOut }),
    }),
    result: ({ optedOut }) => ({ optedOut }),
  });
}
