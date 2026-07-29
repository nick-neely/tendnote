import { describe, expect, it } from "vitest";
import { isInstantMutationAction, mutationActionFor, PRIMARY_OWNER } from "./fixture-data";
import { restoreInstantMutationAction } from "./restore";

/**
 * The teardown that keeps one project's failure out of the next one (#331).
 *
 * What is worth pinning here is the *guard*, not the write: this is the one
 * place in the fixture that updates a row outside the seed, and the thing that
 * keeps it from becoming an arbitrary update against whatever `DATABASE_URL`
 * happens to point at is that it refuses every identifier the fixture did not
 * seed as a private mutation Action. That refusal has to happen before any
 * connection is opened, which is also what makes it testable without one.
 */
describe("Instant fixture mutation-Action restore", () => {
  it("recognises exactly the private mutation Actions", () => {
    const mine = mutationActionFor(0);
    expect(isInstantMutationAction(mine.id)).toEqual(mine);

    // Seeded, asserted by navigation markers, and never written — so restoring
    // it is a category error rather than a harmless no-op.
    const readOnly = PRIMARY_OWNER.actions.find(
      (action) => action.title === "Renew the library card",
    );
    expect(readOnly).toBeDefined();
    expect(isInstantMutationAction(readOnly?.id ?? "")).toBeNull();
    expect(isInstantMutationAction("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("refuses to write a row the fixture did not seed as private", async () => {
    await expect(
      restoreInstantMutationAction("00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(/not one of the Instant fixture's private mutation Actions/);
  });

  it("gives every worker slot a record no other slot can restore", () => {
    const first = mutationActionFor(0);
    const second = mutationActionFor(1);
    expect(first.id).not.toBe(second.id);
    expect(first.status).toBe("open");
    expect(first.completedAt).toBeNull();
  });
});
