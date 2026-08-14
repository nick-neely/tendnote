import { getOwnerTodayContext } from "@tendnote/db/queries/today";
import { defineDynamic, defineInstructions } from "eve/instructions";
import type { resolveOrientationCaller } from "./self-context-orientation";

type DateAnchorContext = Parameters<typeof resolveOrientationCaller>[0];

/**
 * Today's date as a friendly + ISO string, anchored in the owner's own timezone.
 *
 * The model has no inherent knowledge of the current date and will otherwise
 * guess - often a year in the past - which makes it resolve relative asks like
 * "anything next week?" to the wrong window (see the get_relationship_agenda
 * calendar). Anchoring the prompt on the real date fixes that for every tool
 * that takes a concrete date, not just the agenda.
 *
 * The *zone* matters as much as the date. This service runs in UTC, so between
 * 4pm and midnight a Pacific owner asking Eve to "remind me tomorrow" was being
 * anchored on a day they had not reached yet, and every ISO date Eve derived
 * from it landed a day early. The owner's zone comes from the same shared
 * `getOwnerTodayContext` the Household check-in and the ledger lists use, so one
 * answer to "what day is it for this person" serves all of them.
 */
export function currentDateMarkdown(now: Date, timeZone: string): string {
  const iso = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(now);
  const friendly = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone,
  });

  return [
    "# Today's date",
    "",
    `Today is ${friendly} (${iso}) in the user's own timezone (${timeZone}).`,
    "",
    "You have no other knowledge of the current date - always anchor on this one.",
    'Resolve every relative date the user mentions ("today", "tomorrow", "this',
    'weekend", "next week", "in a month") against it, and pass concrete ISO 8601',
    "dates to any tool that needs them.",
  ].join("\n");
}

/**
 * The owner's timezone, or UTC.
 *
 * A date anchor is worth more than a perfect one: an unauthenticated or runtime
 * session has no owner to read a zone for, and a projection failure must not cost
 * the turn its only knowledge of what day it is. Both fall back to UTC, which is
 * exactly what this resolver used to hand every caller.
 */
async function resolveOwnerTimeZone(
  ctx: DateAnchorContext,
  resolveCaller: (ctx: DateAnchorContext) => string | null,
) {
  const ownerUserId = resolveCaller(ctx);
  if (!ownerUserId) return "UTC";

  try {
    return (await getOwnerTodayContext({ ownerUserId })).timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * The date anchor as an instructions slot, for the root agent and for each declared
 * subagent.
 *
 * A subagent inherits nothing from the root - not this instruction, not the date it
 * carries - so every agent node that resolves a date needs its own. They differ only
 * in which sessions may look up a zone, which is why the caller resolver is a
 * parameter: the root reuses the stricter orientation rule, and a subagent session,
 * whose whole point is that it has a parent, uses the authenticated-caller rule that
 * its own tools already scope their reads by.
 *
 * Recomputed at the start of every turn so the date stays correct across midnight
 * and long-lived sessions. It stays stable within a day, so prompt caching for the
 * system block is preserved between turns on the same date.
 */
export function currentDateAnchor(resolveCaller: (ctx: DateAnchorContext) => string | null) {
  return defineDynamic({
    events: {
      // A dynamic instructions resolver returns the branded defineInstructions()
      // value directly, not wrapped in a `{ export }` map (that's the tool shape).
      // An unbranded return is silently dropped, so the date never reaches the prompt.
      "turn.started": async (_event, ctx) =>
        defineInstructions({
          markdown: currentDateMarkdown(new Date(), await resolveOwnerTimeZone(ctx, resolveCaller)),
        }),
    },
  });
}
