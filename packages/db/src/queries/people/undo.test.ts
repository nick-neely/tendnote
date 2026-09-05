import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { createInMemoryPeopleStore } from "./in-memory-store";
import { createAffectedPeopleQueries } from "./mutation-queries";

function requireUpdate(
  outcome: Awaited<ReturnType<ReturnType<typeof createAffectedPeopleQueries>["updatePerson"]>>,
) {
  assert.ok(outcome.result?.update);
  return outcome.result.update;
}

async function setup() {
  const queries = createAffectedPeopleQueries(createInMemoryPeopleStore());
  const { result: person } = await queries.createPerson({
    ownerUserId: "owner",
    displayName: "Mara",
    birthday: "--03-03",
    firstName: "Mara",
  });
  return { queries, input: { ownerUserId: "owner", personId: person.id } };
}

describe("person update undo", () => {
  it("restores a multi-field edit including a clear through the owner mutation", async () => {
    const { queries, input } = await setup();
    const updated = await queries.updatePerson({ ...input, birthday: null, displayName: "Mary" });
    expect(updated.result?.update?.changes).toEqual([
      { field: "displayName", before: "Mara", after: "Mary" },
      { field: "birthday", before: "--03-03", after: null },
    ]);
    const target = requireUpdate(updated).target;
    const restored = await queries.undoPersonUpdate({ ...input, ...target });
    expect(restored.result.status).toBe("applied");
    expect(restored.affectedScopes.length).toBeGreaterThan(0);
    expect(await queries.getPerson(input)).toMatchObject({
      displayName: "Mara",
      birthday: "--03-03",
      firstName: "Mara",
    });
    expect(await queries.getLatestPersonUpdate(input)).toBeNull();
  });
  it("keeps the latest inverse across reads and no-ops, then consumes it once", async () => {
    const { queries, input } = await setup();
    const edit = await queries.updatePerson({ ...input, displayName: "Mary" });
    const target = requireUpdate(edit).target;
    const noop = await queries.updatePerson({ ...input, displayName: "Mary" });
    expect(noop.result?.update).toBeNull();
    expect(noop.affectedScopes).toEqual([]);
    expect((await queries.getLatestPersonUpdate(input))?.target).toEqual(target);
    const results = await Promise.all([
      queries.undoPersonUpdate({ ...input, ...target }),
      queries.undoPersonUpdate({ ...input, ...target }),
    ]);
    expect(results.map(({ result }) => result.status).sort()).toEqual([
      "already_undone",
      "applied",
    ]);
    expect((await queries.undoPersonUpdate({ ...input, ...target })).result.status).toBe(
      "already_undone",
    );
  });

  it("never revives an old inverse when values cycle back or the latest update is undone", async () => {
    const { queries, input } = await setup();
    const first = await queries.updatePerson({ ...input, displayName: "Mary" });
    await queries.updatePerson({ ...input, displayName: "Mara" });
    const last = await queries.updatePerson({ ...input, displayName: "Mary" });
    const oldTarget = requireUpdate(first).target;
    expect((await queries.undoPersonUpdate({ ...input, ...oldTarget })).result.status).toBe(
      "superseded",
    );
    await queries.undoPersonUpdate({ ...input, ...requireUpdate(last).target });
    expect((await queries.undoPersonUpdate({ ...input, ...oldTarget })).result.status).toBe(
      "superseded",
    );
    expect(await queries.getLatestPersonUpdate(input)).toBeNull();
  });

  it("rejects wrong owners, forged ids, and deleted people without restoration", async () => {
    const { queries, input } = await setup();
    const edit = await queries.updatePerson({ ...input, birthday: "1990-04-05" });
    const target = requireUpdate(edit).target;
    expect(await queries.getLatestPersonUpdate({ ...input, ownerUserId: "stranger" })).toBeNull();
    expect(
      (await queries.undoPersonUpdate({ ...target, ownerUserId: "stranger" })).result.status,
    ).toBe("unavailable");
    expect((await queries.undoPersonUpdate({ ...input, updateId: "forged" })).result.status).toBe(
      "superseded",
    );
    await queries.deletePerson(input);
    expect((await queries.undoPersonUpdate({ ...input, ...target })).result.status).toBe(
      "unavailable",
    );
    expect(await queries.getPerson(input)).toBeNull();
  });

  it("restores all supported fields and full-year birthday precision", async () => {
    const { queries, input } = await setup();
    await queries.updatePerson({ ...input, birthday: "1989-03-03" });
    const edit = await queries.updatePerson({
      ...input,
      displayName: "Mary Smith",
      firstName: null,
      lastName: "Smith",
      birthday: "--04-05",
      relationshipType: "family",
      closenessLevel: 5,
      profileBlurb: "Cousin",
    });
    await queries.undoPersonUpdate({ ...input, ...requireUpdate(edit).target });
    expect(await queries.getPerson(input)).toMatchObject({
      displayName: "Mara",
      firstName: "Mara",
      lastName: null,
      birthday: "1989-03-03",
      relationshipType: "other",
      closenessLevel: 3,
      profileBlurb: null,
    });
  });
  it("reconciles on an idempotent retry after the first response is lost", async () => {
    const { queries, input } = await setup();
    const edit = await queries.updatePerson({ ...input, displayName: "Mary" });
    const target = requireUpdate(edit).target;
    // The first response is discarded before its affected scopes can be reconciled.
    await queries.undoPersonUpdate({ ...input, ...target });
    const retry = await queries.undoPersonUpdate({ ...input, ...target });
    expect(retry.result.status).toBe("already_undone");
    expect(retry.affectedScopes).toContainEqual({
      kind: "viewer-entity",
      entity: "person",
      entityId: input.personId,
      viewerUserId: "owner",
    });
    expect((await queries.getPerson(input))?.displayName).toBe("Mara");
  });
});
