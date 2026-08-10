import { ContextFactConflictError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy } from "@/test/action-adapter-mocks";

const db = vi.hoisted(() => ({
  createHouseholdContextFact: vi.fn(),
  updateHouseholdContextFact: vi.fn(),
  archiveHouseholdContextFact: vi.fn(),
  restoreHouseholdContextFact: vi.fn(),
}));

vi.mock("@tendnote/db/queries/context-facts", () => db);

import {
  archiveHouseholdContextFactAction,
  createHouseholdContextFactAction,
  updateHouseholdContextFactAction,
} from "./household-context";

const FACT_ID = "00000000-0000-4000-8000-000000000001";
const UPDATED_AT = "2026-08-09T12:00:00.000Z";

function saved() {
  return {
    result: { outcome: "saved", decision: "updated", fact: { id: FACT_ID } },
    affectedScopes: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  db.createHouseholdContextFact.mockResolvedValue(saved());
  db.updateHouseholdContextFact.mockResolvedValue(saved());
  db.archiveHouseholdContextFact.mockResolvedValue(saved());
});

describe("household context actions", () => {
  /**
   * The caller comes from the session gate, never from the payload. A shared
   * surface that accepted an actor id would let one member write as another.
   */
  it("takes the caller from admission rather than from the request", async () => {
    await createHouseholdContextFactAction({
      category: "location",
      content: "We're in the Lents neighbourhood.",
    });

    expect(db.createHouseholdContextFact).toHaveBeenCalledWith(
      expect.objectContaining({ callerUserId: "owner-1" }),
      expect.any(Function),
    );
  });

  it("names no household, so no payload can point a write at another workspace", async () => {
    await createHouseholdContextFactAction({
      category: "location",
      content: "We're in the Lents neighbourhood.",
    });

    expect(db.createHouseholdContextFact.mock.calls[0]?.[0]).not.toHaveProperty("householdId");
  });

  it("refuses a write that carries no version of what its author saw", async () => {
    const result = await updateHouseholdContextFactAction({
      contextFactId: FACT_ID,
      category: "location",
      content: "We moved.",
      sensitivity: "normal",
    } as never);

    expect(result.ok).toBe(false);
    expect(db.updateHouseholdContextFact).not.toHaveBeenCalled();
  });

  it("passes the version through as the instant the surface rendered", async () => {
    await updateHouseholdContextFactAction({
      contextFactId: FACT_ID,
      expectedUpdatedAt: UPDATED_AT,
      category: "location",
      content: "We moved.",
      sensitivity: "normal",
    });

    expect(db.updateHouseholdContextFact.mock.calls[0]?.[0]).toMatchObject({
      expectedUpdatedAt: new Date(UPDATED_AT),
    });
  });

  it("returns a stale write as an outcome to render, not as a failure", async () => {
    const reconciliation = {
      draft: { category: "location", content: "Mine.", sensitivity: "normal" },
      current: {
        contextFactId: FACT_ID,
        category: "location",
        content: "Theirs.",
        sensitivity: "normal",
        lifecycle: "active",
        updatedAt: new Date(UPDATED_AT),
        lastActorUserId: "member-2",
      },
      choices: ["keep_current", "revise", "replace"],
      draftDiffers: true,
    };
    db.updateHouseholdContextFact.mockResolvedValue({
      result: { outcome: "stale", reconciliation },
      affectedScopes: [],
    });

    const result = await updateHouseholdContextFactAction({
      contextFactId: FACT_ID,
      expectedUpdatedAt: UPDATED_AT,
      category: "location",
      content: "Mine.",
      sensitivity: "normal",
    });

    expect(result).toEqual({ ok: true, view: { outcome: "stale", reconciliation } });
  });

  it("points a duplicate at the fact the household already has", async () => {
    db.createHouseholdContextFact.mockRejectedValue(
      new ContextFactConflictError("Someone here has already written this down.", FACT_ID),
    );

    const result = await createHouseholdContextFactAction({
      category: "location",
      content: "We're in the Lents neighbourhood.",
    });

    expect(result).toMatchObject({ ok: false, focusContextFactId: FACT_ID });
  });

  it("accepts Composition, which only a household fact may use", async () => {
    const result = await createHouseholdContextFactAction({
      category: "composition",
      content: "Two adults and a cat.",
    });
    expect(result.ok).toBe(true);
  });

  it("keeps archive fenced on the same version contract as an edit", async () => {
    await archiveHouseholdContextFactAction({
      contextFactId: FACT_ID,
      expectedUpdatedAt: UPDATED_AT,
    });

    expect(db.archiveHouseholdContextFact.mock.calls[0]?.[0]).toMatchObject({
      callerUserId: "owner-1",
      contextFactId: FACT_ID,
      expectedUpdatedAt: new Date(UPDATED_AT),
    });
  });
});
