import type { ServiceWideHold } from "@tendnote/db/queries/service-wide-hold";

/**
 * What placing and lifting the Service-Wide Hold touch (#634): its records and
 * nothing else. The hold takes effect because the proxy, the recovery cron, and
 * every queue consumer read the open record, so no session, subscription, or
 * account is changed by placing it, and lifting it restores exactly what was.
 */
export type ServiceWideHoldDependencies = {
  findOpenServiceWideHold: () => Promise<ServiceWideHold | null>;
  recordServiceWideHold: (input: { reason: string; placedAt: Date }) => Promise<ServiceWideHold>;
  liftServiceWideHold: (input: { at: Date }) => Promise<ServiceWideHold | null>;
};

/**
 * Place the Service-Wide Hold. From the moment the record commits, the product
 * goes offline for every account within the proxy's re-read interval, leaving
 * only the Stripe webhook receiver, and export, deletion, and background work
 * wait. Running it again while a hold is open changes nothing and says so; the
 * open hold keeps its original reason and time.
 */
export async function placeServiceWideHold(
  deps: ServiceWideHoldDependencies,
  input: { reason: string; now?: Date },
): Promise<{ holdId: string; placedAt: Date; alreadyHeld: boolean }> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A Service-Wide Hold needs a reason.");

  const open = await deps.findOpenServiceWideHold();
  if (open) return { holdId: open.id, placedAt: open.placedAt, alreadyHeld: true };

  const hold = await deps.recordServiceWideHold({ reason, placedAt: input.now ?? new Date() });
  return { holdId: hold.id, placedAt: hold.placedAt, alreadyHeld: false };
}

/**
 * Lift the Service-Wide Hold, the audited transition back to service. The
 * product returns within the proxy's re-read interval, the next cron pass
 * resumes the waiting work, and every waiting deletion intent's alert clock
 * starts from this lift. Refused when no hold is open.
 */
export async function liftServiceWideHold(
  deps: ServiceWideHoldDependencies,
  input: { now?: Date } = {},
): Promise<{ holdId: string; placedAt: Date; liftedAt: Date }> {
  const lifted = await deps.liftServiceWideHold({ at: input.now ?? new Date() });
  if (!lifted?.liftedAt) throw new Error("No Service-Wide Hold is in force.");
  return { holdId: lifted.id, placedAt: lifted.placedAt, liftedAt: lifted.liftedAt };
}

const SERVICE_HOLD_USAGE = `Usage:
  service-hold place <reason>
  service-hold lift`;

/** One hold command from the CLI's arguments; anything else is refused with the usage. */
export function runServiceHoldCommand(
  deps: ServiceWideHoldDependencies,
  [action, ...rest]: readonly string[],
): Promise<unknown> {
  if (action === "place" && rest.length > 0) {
    return placeServiceWideHold(deps, { reason: rest.join(" ") });
  }
  if (action === "lift" && rest.length === 0) return liftServiceWideHold(deps);
  return Promise.reject(new Error(SERVICE_HOLD_USAGE));
}
