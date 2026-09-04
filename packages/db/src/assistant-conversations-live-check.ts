/**
 * Live verification that every Assistant conversation write is owner-scoped,
 * run by hand against the disposable dev database.
 *
 * Not a unit test and deliberately not in the suite: what it proves is the one
 * thing a pure-function test cannot, which is that the `WHERE` clauses actually
 * reach Postgres. `assistant_conversations` is keyed by the Eve session id, and
 * a session id can be *named* by anybody — the web action takes one straight
 * from the browser. So the question this answers is the security question:
 * when two accounts name the same id, does either one's write land on the
 * other's row?
 *
 *   pnpm --filter @tendnote/db db:assistant-conversations:check
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
import {
  archiveAssistantConversation,
  getAssistantConversation,
  listAssistantConversations,
  renameAssistantConversation,
  setAssistantConversationTitle,
  touchAssistantConversation,
  upsertAssistantConversation,
} from "./queries/assistant-conversations";
import { assistantConversations } from "./schema";

async function main() {
  await requireDemoAccounts();

  const sessionId = `wrun_live_${randomUUID()}`;
  const db = getDb();

  try {
    console.log("\nthe intruder pre-claims a session id the owner is about to be given:");
    await upsertAssistantConversation({
      ownerUserId: DEMO_INTRUDER,
      sessionId,
      firstMessage: "A session id I do not own",
    });
    const [claimed] = await db
      .select()
      .from(assistantConversations)
      .where(eq(assistantConversations.sessionId, sessionId));
    check(
      "the pre-claim created exactly one row, owned by the intruder",
      claimed?.ownerUserId === DEMO_INTRUDER,
      claimed,
    );

    console.log("\nthe owner's own writes never reach it:");
    await upsertAssistantConversation({
      ownerUserId: DEMO_OWNER,
      sessionId,
      firstMessage: "My conversation",
    });
    const [afterUpsert] = await db
      .select()
      .from(assistantConversations)
      .where(eq(assistantConversations.sessionId, sessionId));
    check(
      "a conflicting upsert left the row's owner, title, and opening message alone",
      afterUpsert?.ownerUserId === DEMO_INTRUDER &&
        afterUpsert?.title === claimed?.title &&
        afterUpsert?.firstMessage === claimed?.firstMessage,
      afterUpsert,
    );
    check(
      "it did not even nudge the stranger's thread up their list",
      afterUpsert?.lastActivityAt?.getTime() === claimed?.lastActivityAt?.getTime(),
      { before: claimed?.lastActivityAt, after: afterUpsert?.lastActivityAt },
    );

    check(
      "the owner cannot read it",
      (await getAssistantConversation({ ownerUserId: DEMO_OWNER, sessionId })) === null,
    );
    check(
      "it is absent from the owner's list",
      (await listAssistantConversations({ ownerUserId: DEMO_OWNER, includeArchived: true })).every(
        (conversation) => conversation.sessionId !== sessionId,
      ),
    );
    check(
      "the owner cannot rename it",
      (await renameAssistantConversation({
        ownerUserId: DEMO_OWNER,
        sessionId,
        title: "Renamed by a stranger",
      })) === null,
    );
    check(
      "the owner cannot archive it",
      (await archiveAssistantConversation({ ownerUserId: DEMO_OWNER, sessionId })) === null,
    );

    console.log("\nand neither do the agent hook's writes, which run inside the session:");
    check(
      "touch finds nothing for the wrong owner",
      (await touchAssistantConversation({ ownerUserId: DEMO_OWNER, sessionId })) === null,
    );
    check(
      "the model title lands nowhere for the wrong owner",
      (await setAssistantConversationTitle({
        ownerUserId: DEMO_OWNER,
        sessionId,
        title: "Leaked model title",
        source: "model",
      })) === false,
    );
    const [afterHook] = await db
      .select()
      .from(assistantConversations)
      .where(eq(assistantConversations.sessionId, sessionId));
    check(
      "the intruder's row still carries its own placeholder title",
      afterHook?.title === claimed?.title && afterHook?.titleSource === "placeholder",
      afterHook,
    );

    console.log("\nand the same writes do land for the account that owns the row:");
    check(
      "touch answers for the real owner",
      (await touchAssistantConversation({ ownerUserId: DEMO_INTRUDER, sessionId })) !== null,
    );
    check(
      "the model title lands for the real owner",
      (await setAssistantConversationTitle({
        ownerUserId: DEMO_INTRUDER,
        sessionId,
        title: "The real title",
        source: "model",
      })) === true,
    );
    const renamed = await renameAssistantConversation({
      ownerUserId: DEMO_INTRUDER,
      sessionId,
      title: "Named by hand",
    });
    check(
      "an owner rename is recorded as an owner title, not a model one",
      renamed?.title === "Named by hand" && renamed?.titleSource === "owner",
      renamed,
    );
  } finally {
    await db.delete(assistantConversations).where(eq(assistantConversations.sessionId, sessionId));
  }

  reportLiveCheckResult();
}

void main();
