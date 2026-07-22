import { listAdmittedOwnerUserIds } from "@tendnote/db/queries/access-profiles";
import { dispatchActionSummary } from "@tendnote/db/queries/action-summary";
import { dispatchBirthdayGiftPlanning } from "@tendnote/db/queries/birthday-gift-planning";
import {
  dispatchDueBriefs,
  ensureDefaultBriefSchedulesForOwner,
} from "@tendnote/db/queries/brief-schedules";
import { dispatchPostMeetingAftercare } from "@tendnote/db/queries/post-meeting-aftercare";
import { defineSchedule } from "eve/schedules";
import { createDiscordProactiveDeliverySender } from "../channels/discord";
import { resolveScheduledOwnerUserIds } from "../lib/schedule-owners";

const timezone = process.env.TENDNOTE_BRIEF_TIMEZONE ?? "UTC";

type DiscordProactiveDeliverySender = ReturnType<typeof createDiscordProactiveDeliverySender>;

/**
 * The optional `discordSender` field for a single-channel dispatch, present only when a
 * Discord sender is configured. Kept as a helper so the dispatch handler stays a flat
 * list of calls rather than repeating the same conditional spread at each call site.
 */
function discordDeliveryOption(sender: DiscordProactiveDeliverySender) {
  return sender ? { discordSender: sender } : {};
}

/** The two brief-specific Discord delivery fields `dispatchDueBriefs` accepts. */
function briefDiscordOptions(sender: DiscordProactiveDeliverySender) {
  return sender
    ? { morningAgendaDiscordSender: sender, weeklyRelationshipReviewDiscordSender: sender }
    : {};
}

/**
 * App-owned brief schedule dispatcher (PRD #65, issue #72, ADR-0066). This is the
 * single static root schedule; per-user daily and weekly timing lives in Tendnote
 * schedule rows. The handler wakes on a fixed UTC cadence, atomically claims the
 * due rows, and calls the shared owner-scoped brief generator directly. It does
 * NOT start an Eve chat session or use `receive(...)`/proactive channel delivery —
 * in-app brief persistence is a direct database write, and external delivery is
 * out of scope for Phase 1F.
 *
 * Vercel evaluates cron in UTC; waking every 15 minutes lets the application rows'
 * timezone-derived next-run times fire close to each owner's local schedule.
 */
export default defineSchedule({
  cron: "*/15 * * * *",
  run({ waitUntil }) {
    const discordSender = createDiscordProactiveDeliverySender();

    // Per-row generation errors are handled inside the dispatcher; this catch
    // covers a claim or bootstrap failure so the cron task never ends on an
    // unobserved rejection.
    waitUntil(
      resolveScheduledOwnerUserIds({ listAdmittedOwnerUserIds })
        .then(async (ownerUserIds) => {
          await Promise.all(
            ownerUserIds.map((ownerUserId) =>
              ensureDefaultBriefSchedulesForOwner({ ownerUserId, timezone }),
            ),
          );

          await Promise.all([
            dispatchDueBriefs({
              ...briefDiscordOptions(discordSender),
            }).catch((error) => {
              console.error("Brief schedule dispatch failed.", error);
            }),
            ...ownerUserIds.flatMap((ownerUserId) => [
              dispatchPostMeetingAftercare({
                ownerUserId,
                ...discordDeliveryOption(discordSender),
              }).catch((error) => {
                console.error("Post-meeting aftercare dispatch failed.", error);
              }),
              dispatchBirthdayGiftPlanning({
                ownerUserId,
                timezone,
                ...discordDeliveryOption(discordSender),
              }).catch((error) => {
                console.error("Birthday gift planning dispatch failed.", error);
              }),
              // The Phase 5 scoped action summary rides the same root schedule; the
              // dispatch itself gates to at most once per local day.
              dispatchActionSummary({
                ownerUserId,
                timezone,
                ...discordDeliveryOption(discordSender),
              }).catch((error) => {
                console.error("Action summary dispatch failed.", error);
              }),
            ]),
          ]);
        })
        .catch((error) => {
          console.error("Scheduled workflow owner resolution or bootstrap failed.", error);
        }),
    );
  },
});
