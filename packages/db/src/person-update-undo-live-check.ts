/** Real Postgres proof for #557: locks, rollback, owner isolation, and bounded receipts.
 * Run against the local seeded database with `pnpm --filter @tendnote/db exec tsx src/person-update-undo-live-check.ts`.
 */
import assert from "node:assert/strict";
import { closeDb, withDatabaseTransaction } from "./client";
import { DEMO_INTRUDER, DEMO_OWNER, requireDemoAccounts } from "./live-check";
import {
  createPerson,
  deletePerson,
  getLatestPersonUpdate,
  getPerson,
  getPersonUpdateStatus,
  undoPersonUpdate,
  updatePerson,
} from "./queries/people";

function requireUpdate(outcome: Awaited<ReturnType<typeof updatePerson>>) {
  assert.ok(outcome.result?.update);
  return outcome.result.update;
}

async function checkCompetingEdits(input: { ownerUserId: string; personId: string }) {
  const edits = await Promise.all([
    updatePerson({ ...input, displayName: "First" }),
    updatePerson({ ...input, displayName: "Second" }),
  ]);
  const latest = await getLatestPersonUpdate(input);
  assert.ok(latest);
  const staleEdit = edits.find(
    ({ result }) => result?.update?.target.updateId !== latest.target.updateId,
  );
  assert.ok(staleEdit);
  const stale = requireUpdate(staleEdit);
  assert.equal((await undoPersonUpdate({ ...input, ...stale.target })).result.status, "superseded");
  await undoPersonUpdate({ ...input, ...latest.target });
  assert.equal(await getLatestPersonUpdate(input), null);
  assert.equal((await undoPersonUpdate({ ...input, ...stale.target })).result.status, "superseded");
}

async function checkRollback(input: { ownerUserId: string; personId: string }) {
  const before = await getPerson(input);
  await assert.rejects(
    withDatabaseTransaction(async () => {
      await updatePerson({ ...input, displayName: "Rolled back" });
      throw new Error("rollback fixture");
    }),
    /rollback fixture/,
  );
  assert.equal((await getPerson(input))?.displayName, before?.displayName);
  assert.equal(await getLatestPersonUpdate(input), null);
}

async function main() {
  await requireDemoAccounts();
  const { result: person } = await createPerson({
    ownerUserId: DEMO_OWNER,
    displayName: "Undo concurrency fixture",
    birthday: "--03-03",
  });
  const input = { ownerUserId: DEMO_OWNER, personId: person.id };
  try {
    const first = await updatePerson({ ...input, birthday: null });
    const target = requireUpdate(first).target;
    assert.equal(
      (await undoPersonUpdate({ ...target, ownerUserId: DEMO_INTRUDER })).result.status,
      "unavailable",
    );
    const pair = await Promise.all([
      undoPersonUpdate({ ...input, ...target }),
      undoPersonUpdate({ ...input, ...target }),
    ]);
    assert.deepEqual(pair.map(({ result }) => result.status).sort(), ["already_undone", "applied"]);
    assert.equal((await getPerson(input))?.birthday, "--03-03");
    assert.equal(await getLatestPersonUpdate(input), null);
    assert.equal((await getPersonUpdateStatus({ ...input, ...target })).status, "already_undone");

    await checkCompetingEdits(input);

    await checkRollback(input);

    const raceEdit = await updatePerson({ ...input, birthday: "1990-04-05" });
    const raceTarget = requireUpdate(raceEdit).target;
    await Promise.all([
      undoPersonUpdate({ ...input, ...raceTarget }),
      updatePerson({ ...input, birthday: "--06-07" }),
    ]);
    assert.equal((await getPerson(input))?.birthday, "--06-07");
    assert.equal((await undoPersonUpdate({ ...input, ...raceTarget })).result.status, "superseded");
    await deletePerson(input);
    assert.equal(
      (await undoPersonUpdate({ ...input, ...raceTarget })).result.status,
      "unavailable",
    );
    console.log(
      "Person Undo: Postgres concurrency, rollback, owner isolation, and deletion passed.",
    );
  } finally {
    await deletePerson(input);
    await closeDb();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
