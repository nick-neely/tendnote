import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HouseholdRecordUnavailableError, PersonReferenceValidationError } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemoryPersonReferenceStore } from "./in-memory-store";
import { createPersonReferences } from "./references";
import type { PersonReferenceHost } from "./types";

const CREATOR = "member-1";
const OTHER_MEMBER = "member-2";
const OUTSIDER = "outsider-1";

async function setup() {
  const store = createInMemoryPersonReferenceStore();
  const household = await seedHouseholdWithMembers(store, {
    ownerUserId: CREATOR,
    name: "Rivera House",
    members: [
      [CREATOR, "owner"],
      [OTHER_MEMBER, "member"],
    ],
  });

  /**
   * A household-native coordination record: every active member holds the same
   * authority over it, and no creator privilege applies.
   */
  const plan: PersonReferenceHost = {
    kind: "general_action",
    id: "11111111-1111-4111-8111-111111111111",
    ownerUserId: CREATOR,
    scope: "household",
    householdId: household.id,
    ownership: "household_native",
  };

  return { store, household, plan, references: createPersonReferences(store) };
}

describe("adding a reference", () => {
  it("stores the deliberately supplied label on the record", async () => {
    const { references, plan } = await setup();

    const reference = await references.addPersonReference({
      actorUserId: CREATOR,
      host: plan,
      label: "Dr. Alvarez",
    });

    expect(reference.label).toBe("Dr. Alvarez");
    expect(reference.recordId).toBe(plan.id);
  });

  it("carries no link to a Person record", async () => {
    const { references, plan } = await setup();
    const reference = await references.addPersonReference({
      actorUserId: CREATOR,
      host: plan,
      label: "Dr. Alvarez",
    });

    expect(Object.keys(reference)).not.toContain("personId");
  });

  it("refuses contact details", async () => {
    const { references, plan } = await setup();

    await expect(
      references.addPersonReference({
        actorUserId: CREATOR,
        host: plan,
        label: "alvarez@example.com",
      }),
    ).rejects.toThrow(PersonReferenceValidationError);
  });

  it("lets any active member name someone on a household-native record", async () => {
    const { references, plan } = await setup();

    const reference = await references.addPersonReference({
      actorUserId: OTHER_MEMBER,
      host: plan,
      label: "Dr. Alvarez",
    });
    expect(reference.createdByUserId).toBe(OTHER_MEMBER);
  });

  it("refuses someone outside the household, opaquely", async () => {
    const { references, plan } = await setup();

    await expect(
      references.addPersonReference({
        actorUserId: OUTSIDER,
        host: plan,
        label: "Dr. Alvarez",
      }),
    ).rejects.toThrow(HouseholdRecordUnavailableError);
  });

  it("refuses a member whose membership has ended", async () => {
    const { references, plan, store, household } = await setup();
    await removeHouseholdMember(store, { householdId: household.id, userId: OTHER_MEMBER });

    await expect(
      references.addPersonReference({
        actorUserId: OTHER_MEMBER,
        host: plan,
        label: "Dr. Alvarez",
      }),
    ).rejects.toThrow(HouseholdRecordUnavailableError);
  });

  it("audits who named someone, but never the name itself", async () => {
    const { references, plan, store } = await setup();
    await references.addPersonReference({
      actorUserId: CREATOR,
      host: plan,
      label: "Dr. Alvarez",
    });

    const entries = await store.listAuditLogEntries({ ownerUserId: CREATOR });
    expect(entries.at(-1)?.action).toBe("person_reference.add");
    expect(JSON.stringify(entries.at(-1))).not.toContain("Alvarez");
  });
});

describe("reading references", () => {
  it("returns the references on the record the caller may see", async () => {
    const { references, plan } = await setup();
    await references.addPersonReference({ actorUserId: CREATOR, host: plan, label: "Dr. Alvarez" });
    await references.addPersonReference({ actorUserId: CREATOR, host: plan, label: "Bev" });

    const listed = await references.listPersonReferences({
      actorUserId: OTHER_MEMBER,
      host: plan,
    });
    expect(listed.map((reference) => reference.label)).toEqual(["Bev", "Dr. Alvarez"]);
  });

  it("returns nothing to a caller who cannot see the record", async () => {
    const { references, plan } = await setup();
    await references.addPersonReference({ actorUserId: CREATOR, host: plan, label: "Dr. Alvarez" });

    expect(await references.listPersonReferences({ actorUserId: OUTSIDER, host: plan })).toEqual(
      [],
    );
  });

  it("keeps one record's references out of another's", async () => {
    const { references, plan } = await setup();
    await references.addPersonReference({ actorUserId: CREATOR, host: plan, label: "Dr. Alvarez" });

    const otherPlan = { ...plan, id: "22222222-2222-4222-8222-222222222222" };
    expect(
      await references.listPersonReferences({ actorUserId: CREATOR, host: otherPlan }),
    ).toEqual([]);
  });

  it("stays out of ambient surfaces when the host is restricted", async () => {
    const { references, plan } = await setup();
    const restrictedPlan = { ...plan, sensitivity: "restricted" as const };
    await references.addPersonReference({
      actorUserId: CREATOR,
      host: restrictedPlan,
      label: "Dr. Alvarez",
    });

    expect(
      await references.listPersonReferences({
        actorUserId: OTHER_MEMBER,
        host: restrictedPlan,
        purpose: "ambient",
      }),
    ).toEqual([]);
    expect(
      await references.listPersonReferences({
        actorUserId: OTHER_MEMBER,
        host: restrictedPlan,
        purpose: "direct",
      }),
    ).toHaveLength(1);
  });
});

describe("removing a reference", () => {
  it("removes it from its own record", async () => {
    const { references, plan, store } = await setup();
    const reference = await references.addPersonReference({
      actorUserId: CREATOR,
      host: plan,
      label: "Dr. Alvarez",
    });

    await references.removePersonReference({
      actorUserId: OTHER_MEMBER,
      host: plan,
      personReferenceId: reference.id,
    });

    expect(store.allPersonReferences()).toEqual([]);
  });

  it("cannot be reached through a record the caller may not touch", async () => {
    const { references, plan, store } = await setup();
    const reference = await references.addPersonReference({
      actorUserId: CREATOR,
      host: plan,
      label: "Dr. Alvarez",
    });

    await expect(
      references.removePersonReference({
        actorUserId: OUTSIDER,
        host: plan,
        personReferenceId: reference.id,
      }),
    ).rejects.toThrow(HouseholdRecordUnavailableError);
    expect(store.allPersonReferences()).toHaveLength(1);
  });

  it("cannot be reached by naming a different record", async () => {
    const { references, plan, store } = await setup();
    const reference = await references.addPersonReference({
      actorUserId: CREATOR,
      host: plan,
      label: "Dr. Alvarez",
    });

    await references.removePersonReference({
      actorUserId: CREATOR,
      host: { ...plan, id: "22222222-2222-4222-8222-222222222222" },
      personReferenceId: reference.id,
    });
    expect(store.allPersonReferences()).toHaveLength(1);
  });
});

/**
 * The structural half of acceptance criterion three. The behavioural tests
 * above prove the current entry points do not disclose a Person; these prove
 * there is no *shape* here through which a future one could.
 */
describe("the seam cannot reach a People graph", () => {
  const sources = ["references.ts", "types.ts", "drizzle-store.ts"].map((file) =>
    readFileSync(join(import.meta.dirname, file), "utf8"),
  );

  it("never mentions a person id or the people table", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/\bpersonId\b/);
      expect(source).not.toMatch(/\bpeople\./);
    }
  });

  it("has no query that reaches past a single record", () => {
    const adapter = sources.at(-1) ?? "";
    // Every read is `recordKind` + `recordId`; a household-wide or label-keyed
    // predicate would be an access path from a name to records that mention it.
    expect(adapter).not.toContain("personReferences.householdId");
    expect(adapter.match(/eq\(personReferences\.label/g) ?? []).toHaveLength(1);
  });
});
