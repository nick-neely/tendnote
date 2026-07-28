import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryPeopleStore } from "./in-memory-store";
import { createAffectedPeopleQueries } from "./mutation-queries";

const OWNER = "owner-1";

function expectedPersonScopes(personId: string) {
  return [
    { kind: "owner-collection", collection: "people", ownerUserId: OWNER },
    { kind: "viewer-entity", entity: "person", entityId: personId, viewerUserId: OWNER },
    { kind: "visible-entity", entity: "person", entityId: personId },
  ];
}

describe("People affected-scope contract", () => {
  it("routes the production People queries through the affected-scope seam", () => {
    // This repo has no live Drizzle adapter harness. Per #315, the production
    // half of the store contract is an intentional source-wiring guard; the
    // behavioral half runs against the in-memory adapter below.
    const source = readFileSync(join(import.meta.dirname, "..", "people.ts"), "utf8");
    expect(source).toContain("createAffectedPeopleQueries(createDrizzlePeopleStore())");
  });

  it("returns one mutation outcome for create, update, and delete", async () => {
    const people = createAffectedPeopleQueries(createInMemoryPeopleStore());

    const created = await people.createPerson({
      ownerUserId: OWNER,
      displayName: "Mara Lin",
    });
    expect(created.result).toMatchObject({ ownerUserId: OWNER, displayName: "Mara Lin" });
    expect(created.affectedScopes).toEqual(expectedPersonScopes(created.result.id));

    const updated = await people.updatePerson({
      ownerUserId: OWNER,
      personId: created.result.id,
      displayName: "Mara Chen",
    });
    expect(updated.result?.displayName).toBe("Mara Chen");
    expect(updated.affectedScopes).toEqual(expectedPersonScopes(created.result.id));

    const deleted = await people.deletePerson({
      ownerUserId: OWNER,
      personId: created.result.id,
    });
    expect(deleted.result?.id).toBe(created.result.id);
    expect(deleted.affectedScopes).toEqual(expectedPersonScopes(created.result.id));
  });

  it("returns no affected scopes when an owner-scoped update touches nothing", async () => {
    const people = createAffectedPeopleQueries(createInMemoryPeopleStore());

    await expect(
      people.updatePerson({
        ownerUserId: OWNER,
        personId: "missing",
        displayName: "Nobody",
      }),
    ).resolves.toEqual({ result: null, affectedScopes: [] });
  });
});
