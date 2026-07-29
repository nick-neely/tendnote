import { createHmac } from "node:crypto";
import { PRIMARY_OWNER } from "@tendnote/db/instant/fixture-data";
import { restoreInstantMutationAction } from "@tendnote/db/instant/restore";
import { instantBaseUrl, instantBetterAuthSecret } from "./rig";

/**
 * Put a mutation scenario's Action back to seeded state, cache included.
 *
 * ## Why the teardown exists at all
 *
 * ADR 0210 requires every mutation scenario to begin from known state and
 * restore it through the product's own commands, and the complete-and-reopen
 * spec does — on the path where it finishes. A spec that breaches a budget in
 * the *complete* half never reaches the reopen, and both browser projects read
 * the one Postgres service the CI job runs. That is how #331's re-run turned one
 * real failure into two: `desktop-chromium` failed on its reconciliation budget,
 * and `mobile-chromium` then failed with "element(s) not found" for a row that
 * was simply still completed — a report that looks like a second product defect
 * and is not one.
 *
 * ## Why restoring the row is not enough
 *
 * Measured, not assumed. With only the database write in place, forcing the
 * desktop spec to fail mid-way left the row correctly `open` in Postgres and
 * `mobile-chromium` still failed on the same missing locator: the Actions
 * surface is `use cache` backed, so the completed projection outlives the row
 * that produced it. The product's own answer to an out-of-band write is
 * `/api/internal/cache/reconcile` — the signed endpoint background writers use
 * to name the scopes they invalidated — so the teardown finishes through that
 * rather than inventing a test-only cache door. The scopes below are the ones
 * `scopesForGeneralAction` produces for a lifecycle write on this Action.
 */
export async function restoreMutationAction(actionId: string): Promise<void> {
  await restoreInstantMutationAction(actionId);
  await reconcileMutationAction(actionId);
}

async function reconcileMutationAction(actionId: string): Promise<void> {
  const body = JSON.stringify({
    scopes: [
      {
        kind: "viewer-collection",
        collection: "general-actions",
        viewerUserId: PRIMARY_OWNER.userId,
      },
      {
        kind: "viewer-entity",
        entity: "general-action",
        entityId: actionId,
        viewerUserId: PRIMARY_OWNER.userId,
      },
      { kind: "owner-collection", collection: "today", ownerUserId: PRIMARY_OWNER.userId },
      { kind: "owner-collection", collection: "review", ownerUserId: PRIMARY_OWNER.userId },
    ],
  });
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", instantBetterAuthSecret())
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const response = await fetch(`${instantBaseUrl()}/api/internal/cache/reconcile`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tendnote-reconcile-timestamp": timestamp,
      "x-tendnote-reconcile-signature": signature,
    },
    body,
  });

  if (!response.ok) {
    // Loudly. A teardown that silently failed to reconcile would restore the
    // row and hand the next project the same stale projection this exists to
    // clear, which is the failure it would then be blamed for.
    throw new Error(
      `Restoring the Instant fixture could not reconcile caches: ${response.status} ${await response.text()}`,
    );
  }
}
