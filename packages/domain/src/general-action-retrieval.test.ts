import { describe, expect, it } from "vitest";
import {
  decideGeneralActionEmbedding,
  type GeneralActionEmbeddingSource,
  generalActionRetrievalMeta,
  isRetrievableGeneralActionStatus,
  projectGeneralActionEmbeddedText,
} from "./index";

function source(
  overrides: Partial<GeneralActionEmbeddingSource> = {},
): GeneralActionEmbeddingSource {
  return {
    id: "action-1",
    ownerUserId: "owner-1",
    title: "Replace the refrigerator water filter",
    notes: null,
    status: "open",
    areaId: null,
    assetHints: [],
    recurrence: null,
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

describe("general action embedding eligibility", () => {
  it("embeds live actions (open, deferred) and paused routines", () => {
    for (const status of ["open", "deferred", "paused"] as const) {
      expect(decideGeneralActionEmbedding(source({ status }))).toEqual({ action: "embed" });
      expect(isRetrievableGeneralActionStatus(status)).toBe(true);
    }
  });

  it("embeds suggested proposals so they can surface in review context", () => {
    expect(decideGeneralActionEmbedding(source({ status: "suggested" }))).toEqual({
      action: "embed",
    });
    // Suggested is not a durable retrievable status — it is owner-only review context.
    expect(isRetrievableGeneralActionStatus("suggested")).toBe(false);
  });

  it("skips terminal and ignored actions", () => {
    for (const status of ["completed", "dismissed", "archived", "ignored"] as const) {
      expect(decideGeneralActionEmbedding(source({ status }))).toEqual({
        action: "skip",
        reason: "general_action_not_retrievable_status",
      });
    }
  });

  it("skips when the projected text is empty", () => {
    expect(decideGeneralActionEmbedding(source({ title: "   " }))).toEqual({
      action: "skip",
      reason: "empty_embedded_text",
    });
  });
});

describe("general action embedded-text projection", () => {
  it("labels title, notes, sorted asset hints, and routine cadence deterministically", () => {
    const text = projectGeneralActionEmbeddedText(
      source({
        title: "Replace   the water filter",
        notes: "Fits the door model  ",
        assetHints: [{ label: "water filter" }, { label: "fridge" }],
        recurrence: { interval: 6, unit: "month" },
      }),
    );

    expect(text).toBe(
      [
        "Action: Replace the water filter",
        "Notes: Fits the door model",
        "Assets: fridge, water filter",
        "Cadence: Every 6 months",
      ].join("\n"),
    );
  });

  it("omits absent optional lines", () => {
    expect(projectGeneralActionEmbeddedText(source({ title: "Book the vet" }))).toBe(
      "Action: Book the vet",
    );
  });
});

describe("general action retrieval metadata", () => {
  it("marks a one-time open action", () => {
    expect(generalActionRetrievalMeta(source({ status: "open", areaId: "area-1" }))).toEqual({
      status: "open",
      isRoutine: false,
      isSuggested: false,
      areaId: "area-1",
    });
  });

  it("marks a routine", () => {
    expect(
      generalActionRetrievalMeta(
        source({ status: "open", recurrence: { interval: 1, unit: "week" } }),
      ),
    ).toEqual({ status: "open", isRoutine: true, isSuggested: false, areaId: null });
  });

  it("marks a suggested proposal", () => {
    expect(generalActionRetrievalMeta(source({ status: "suggested" }))).toEqual({
      status: "suggested",
      isRoutine: false,
      isSuggested: true,
      areaId: null,
    });
  });
});
