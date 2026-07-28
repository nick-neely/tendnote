import { createHmac } from "node:crypto";
import type { AffectedScope } from "@tendnote/db/queries/general-actions";

const RECONCILE_PATH = "/api/internal/cache/reconcile";

/**
 * Asks the web runtime to reconcile scopes emitted by an Eve mutation.
 *
 * Eve runs as a separate Nitro service, so it cannot call `next/cache` directly.
 * The signed web endpoint performs the actual stale-while-revalidate operation in
 * a real Next request context. This is deliberately best-effort: the DB write has
 * already committed, and a cache transport failure must not turn that success into
 * a tool error that invites a duplicate retry.
 */
export async function requestBackgroundAffectedScopeReconciliation(
  scopes: readonly AffectedScope[],
) {
  if (scopes.length === 0) return;
  const secret = process.env.BETTER_AUTH_SECRET;
  const appUrl =
    process.env.TENDNOTE_WEB_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
  if (!secret || !appUrl) {
    console.error("Skipped affected-scope reconciliation: web URL or signing secret is missing.");
    return;
  }

  const body = JSON.stringify({ scopes });
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

  try {
    const response = await fetch(new URL(RECONCILE_PATH, appUrl), {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
      headers: {
        "content-type": "application/json",
        "x-tendnote-reconcile-signature": signature,
        "x-tendnote-reconcile-timestamp": timestamp,
      },
      body,
    });
    if (!response.ok) {
      console.error(`Affected-scope reconciliation failed with HTTP ${response.status}.`);
    }
  } catch (error) {
    console.error("Affected-scope reconciliation request failed.", error);
  }
}
