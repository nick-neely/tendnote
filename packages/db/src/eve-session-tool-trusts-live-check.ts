/**
 * Live verification that a Session Tool Trust can only be recorded by the owner
 * the Eve session is actually bound to, run by hand against the disposable dev
 * database.
 *
 * Not a unit test and deliberately not in the suite: the guard on
 * `recordEveSessionToolTrust` is an `insert ... select` whose source is
 * `eve_session_owners`, and whether that `WHERE` clause reaches Postgres is the
 * one thing a pure-function test cannot answer. The server action behind the
 * approval card's "Don't ask again for this in this conversation" takes the
 * session id straight from the browser, so the question here is the security
 * question: when one account names another account's session id, does a trust
 * row appear?
 *
 *   pnpm --filter @tendnote/db db:eve-session-tool-trusts:check
 *
 * It seeds under the two demo accounts `pnpm db:seed` creates, and removes the
 * rows it made on the way out.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./client";
import {
  check,
  DEMO_INTRUDER,
  DEMO_OWNER,
  reportLiveCheckResult,
  requireDemoAccounts,
} from "./live-check";
import { bindEveSessionOwner } from "./queries/eve-session-owners";
import {
  hasEveSessionToolTrust,
  recordEveSessionToolTrust,
} from "./queries/eve-session-tool-trusts";
import { eveSessionOwners, eveSessionToolTrusts } from "./schema";

const TOOL = "capture_memory";

async function trustRows(sessionId: string) {
  return getDb()
    .select()
    .from(eveSessionToolTrusts)
    .where(eq(eveSessionToolTrusts.sessionId, sessionId));
}

// fallow-ignore-next-line complexity -- Same reason as the sibling decision check: a run of independent assertions against a real Postgres, scored for the unit coverage this file deliberately does not have.
async function main() {
  await requireDemoAccounts();

  const sessionId = `wrun_live_${randomUUID()}`;
  const unknownSessionId = `wrun_live_${randomUUID()}`;
  const db = getDb();

  try {
    await bindEveSessionOwner({ sessionId, ownerUserId: DEMO_OWNER });

    console.log("\nan account that does not hold the session records nothing:");
    check(
      "the intruder is told only that nothing was recorded",
      (await recordEveSessionToolTrust({ ownerUserId: DEMO_INTRUDER, sessionId, toolName: TOOL }))
        .recorded === false,
    );
    check("and no row exists", (await trustRows(sessionId)).length === 0);
    check(
      "so the conversation still trusts nothing",
      (await hasEveSessionToolTrust({ sessionId, toolName: TOOL })) === false,
    );

    console.log("\na session id nobody holds is the same opaque answer:");
    check(
      "an unknown session records nothing",
      (
        await recordEveSessionToolTrust({
          ownerUserId: DEMO_OWNER,
          sessionId: unknownSessionId,
          toolName: TOOL,
        })
      ).recorded === false,
    );
    check("and no row exists for it", (await trustRows(unknownSessionId)).length === 0);

    console.log("\nthe owner the session is bound to records one:");
    check(
      "the write lands",
      (await recordEveSessionToolTrust({ ownerUserId: DEMO_OWNER, sessionId, toolName: TOOL }))
        .recorded === true,
    );
    const [row] = await trustRows(sessionId);
    check(
      "the row carries the session's real owner",
      row?.ownerUserId === DEMO_OWNER && row?.toolName === TOOL,
      row,
    );
    check(
      "and the conversation now trusts that tool",
      (await hasEveSessionToolTrust({ sessionId, toolName: TOOL })) === true,
    );
    check(
      "but only that tool",
      (await hasEveSessionToolTrust({ sessionId, toolName: "create_person" })) === false,
    );

    console.log("\nrepeating it is idempotent, not an error:");
    check(
      "a second identical trust still answers recorded",
      (await recordEveSessionToolTrust({ ownerUserId: DEMO_OWNER, sessionId, toolName: TOOL }))
        .recorded === true,
    );
    check("and there is still exactly one row", (await trustRows(sessionId)).length === 1);

    console.log("\nand the intruder still cannot reach the existing row:");
    check(
      "a conflicting write by the wrong account records nothing",
      (await recordEveSessionToolTrust({ ownerUserId: DEMO_INTRUDER, sessionId, toolName: TOOL }))
        .recorded === false,
    );
    const [afterIntruder] = await trustRows(sessionId);
    check(
      "the row's owner is untouched",
      afterIntruder?.ownerUserId === DEMO_OWNER &&
        afterIntruder?.createdAt?.getTime() === row?.createdAt?.getTime(),
      afterIntruder,
    );
  } finally {
    // The trust rows cascade from the session binding.
    await db.delete(eveSessionOwners).where(eq(eveSessionOwners.sessionId, sessionId));
  }

  reportLiveCheckResult();
}

void main();
