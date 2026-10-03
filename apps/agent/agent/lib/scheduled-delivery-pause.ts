import { readUsageNotices } from "@tendnote/db/queries/usage-bounds";
import type { UsageNotices } from "@tendnote/domain/usage-bounds";

type ReadUsageNotices = (input: { userId: string }) => Promise<UsageNotices>;

/**
 * Whether an owner's scheduled workflows skip their next delivery: their
 * background work is paused at its Account Ceiling until the Usage Period
 * resets (spec #591). Briefs, reviews, the agenda, and aftercare skip it whole,
 * never delivering a reduced version late. Reminders are not scheduled
 * workflows and never come through here.
 *
 * Built once per schedule tick, so each owner's usage is read once however many
 * workflows ask. A read that fails delivers: the entry point still refuses any
 * model call past the ceiling, so a failed read cannot overspend.
 */
export function createScheduledDeliveryPause(
  read: ReadUsageNotices = readUsageNotices,
): (ownerUserId: string) => Promise<boolean> {
  const decisions = new Map<string, Promise<boolean>>();

  return (ownerUserId) => {
    let decision = decisions.get(ownerUserId);
    if (!decision) {
      decision = read({ userId: ownerUserId }).then(
        (notices) => notices.background.state === "paused",
        () => {
          console.warn("usage: could not read usage for a scheduled delivery, so it goes ahead");
          return false;
        },
      );
      decisions.set(ownerUserId, decision);
    }
    return decision;
  };
}
