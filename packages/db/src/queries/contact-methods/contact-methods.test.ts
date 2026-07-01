import { describe, expect, it } from "vitest";
import { createInMemoryContactMethodStore } from "./in-memory-store";

describe("contact method reader", () => {
  const store = createInMemoryContactMethodStore({
    contactMethods: [
      { id: "cm-1", value: "casey@work.com", isPrimary: false, ownerUserId: "u1", personId: "p1" },
      { id: "cm-2", value: "casey@home.com", isPrimary: true, ownerUserId: "u1", personId: "p1" },
      { id: "cm-3", value: "other@x.com", isPrimary: true, ownerUserId: "u2", personId: "p1" },
    ],
  });

  it("lists a person's email contact methods, primary first", async () => {
    const result = await store.listPersonEmailContactMethods({ ownerUserId: "u1", personId: "p1" });
    expect(result.map((cm) => cm.value)).toEqual(["casey@home.com", "casey@work.com"]);
    expect(result[0]?.isPrimary).toBe(true);
  });

  it("is owner-scoped: never returns another owner's contact methods", async () => {
    const result = await store.listPersonEmailContactMethods({ ownerUserId: "u1", personId: "p1" });
    expect(result.map((cm) => cm.id)).not.toContain("cm-3");
  });

  it("is read-only: exposes no insert/update path (no contact enrichment, ADR-0085)", () => {
    // A Gmail draft recipient can never be silently saved as a contact method,
    // because this store has only a read method — there is no write surface.
    expect(Object.keys(store)).toEqual(["listPersonEmailContactMethods"]);
  });
});
