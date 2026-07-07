import { dispatchActionSummary } from "@tendnote/db/queries/action-summary";
import { dispatchBirthdayGiftPlanning } from "@tendnote/db/queries/birthday-gift-planning";
import { dispatchDueBriefs } from "@tendnote/db/queries/brief-schedules";
import { dispatchPostMeetingAftercare } from "@tendnote/db/queries/post-meeting-aftercare";
import { defineSchedule } from "eve/schedules";
import { createDiscordProactiveDeliverySender } from "../channels/discord";

// The private Phase 1 owner and their timezone. Daily and weekly in-app brief
// generation is default-enabled for this owner; the dispatcher seeds the rows on
// first run and honors any later disable.
const ownerUserId = process.env.TENDNOTE_DEV_OWNER_USER_ID ?? "demo-user";
const timezone = process.env.TENDNOTE_BRIEF_TIMEZONE ?? "UTC";

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
  async run({ waitUntil }) {
    const discordSender = createDiscordProactiveDeliverySender();

    // Per-row generation errors are handled inside the dispatcher; this catch
    // covers a claim or bootstrap failure so the cron task never ends on an
    // unobserved rejection.
    waitUntil(
      Promise.all([
        dispatchDueBriefs({
          ensureOwnerUserId: ownerUserId,
          timezone,
          ...(discordSender ? { morningAgendaDiscordSender: discordSender } : {}),
          ...(discordSender ? { weeklyRelationshipReviewDiscordSender: discordSender } : {}),
        }).catch((error) => {
          console.error("Brief schedule dispatch failed.", error);
        }),
        dispatchPostMeetingAftercare({
          ownerUserId,
          ...(discordSender ? { discordSender } : {}),
        }).catch((error) => {
          console.error("Post-meeting aftercare dispatch failed.", error);
        }),
        dispatchBirthdayGiftPlanning({
          ownerUserId,
          timezone,
          ...(discordSender ? { discordSender } : {}),
        }).catch((error) => {
          console.error("Birthday gift planning dispatch failed.", error);
        }),
        // The Phase 5 scoped action summary rides the same root schedule; the dispatch
        // itself gates to at most once per local day so it never becomes a nag loop.
        dispatchActionSummary({
          ownerUserId,
          timezone,
          ...(discordSender ? { discordSender } : {}),
        }).catch((error) => {
          console.error("Action summary dispatch failed.", error);
        }),
      ]),
    );
  },
});
