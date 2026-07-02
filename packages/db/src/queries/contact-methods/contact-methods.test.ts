import { describe, expect, it } from "vitest";
import { createInMemoryContactMethodStore } from "./in-memory-store";

describe("contact method reader", () => {
  const store = createInMemoryContactMethodStore({
    contactMethods: [
      { id: "cm-1", value: "casey@work.com", isPrimary: false, ownerUserId: "u1", personId: "p1" },
      {
        id: "cm-2",
        value: "casey@home.com",
        displayValue: "Casey@Home.com",
        normalizedValue: "casey@home.com",
        isPrimary: true,
        ownerUserId: "u1",
        personId: "p1",
      },
      { id: "cm-3", value: "other@x.com", isPrimary: true, ownerUserId: "u2", personId: "p1" },
      {
        id: "cm-4",
        type: "phone",
        value: "+15551234567",
        displayValue: "+1 (555) 123-4567",
        normalizedValue: "+15551234567",
        isPrimary: false,
        ownerUserId: "u1",
        personId: "p2",
      },
    ],
  });

  it("lists a person's email contact methods, primary first", async () => {
    const result = await store.listPersonEmailContactMethods({ ownerUserId: "u1", personId: "p1" });
    expect(result.map((cm) => cm.value)).toEqual(["casey@home.com", "casey@work.com"]);
    expect(result.map((cm) => cm.displayValue)).toEqual(["Casey@Home.com", "casey@work.com"]);
    expect(result[0]?.isPrimary).toBe(true);
  });

  it("is owner-scoped: never returns another owner's contact methods", async () => {
    const result = await store.listPersonEmailContactMethods({ ownerUserId: "u1", personId: "p1" });
    expect(result.map((cm) => cm.id)).not.toContain("cm-3");
  });

  it("keeps contact enrichment behind an explicit create path", () => {
    expect(Object.keys(store)).toEqual([
      "listPersonEmailContactMethods",
      "findOwnerContactMethodDuplicates",
      "createContactMethod",
    ]);
  });

  it("finds owner-wide normalized email and phone duplicates", async () => {
    const result = await store.findOwnerContactMethodDuplicates({
      ownerUserId: "u1",
      methods: [
        { type: "email", value: "CASEY@HOME.COM", normalizedValue: "casey@home.com" },
        { type: "phone", value: "5551234567", normalizedValue: "+15551234567" },
        { type: "phone", value: "12345", normalizedValue: null },
      ],
    });

    expect(result.map((cm) => [cm.id, cm.personId, cm.normalizedValue])).toEqual([
      ["cm-2", "p1", "casey@home.com"],
      ["cm-4", "p2", "+15551234567"],
    ]);
  });
});
