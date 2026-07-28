import { describe, expect, it } from "vitest";
import {
  deriveMemoryDraft,
  draftToValue,
  formatAssetMemoryValue,
  valueDraftFor,
} from "./asset-memory-value";

describe("formatAssetMemoryValue", () => {
  it("renders exact text values verbatim", () => {
    expect(formatAssetMemoryValue({ type: "text", text: "EDR3RXD1" })).toBe("EDR3RXD1");
  });

  it("renders calendar dates as local days, never shifting across timezones", () => {
    expect(
      formatAssetMemoryValue(
        { type: "date", date: "2026-03-14" },
        new Date("2026-07-13T12:00:00Z"),
      ),
    ).toBe("Mar 14");
  });

  it("renders amounts as plain currency", () => {
    expect(formatAssetMemoryValue({ type: "amount", amount: 42.99, currency: "USD" })).toBe(
      "$42.99",
    );
  });

  it("renders nothing for a freeform-only memory", () => {
    expect(formatAssetMemoryValue(null)).toBeNull();
  });
});

describe("draftToValue", () => {
  const amount = { type: "amount", amount: 42.99, currency: "USD" } as const;

  it("preserves the value's type while parsing the correction", () => {
    expect(draftToValue(amount, "18.5")).toEqual({
      ok: true,
      value: { type: "amount", amount: 18.5, currency: "USD" },
    });
  });

  it("treats an emptied input as a deliberate clear", () => {
    expect(draftToValue(amount, "  ")).toEqual({ ok: true, value: null });
  });

  it("rejects malformed input instead of silently keeping the original", () => {
    // The failure mode this guards: a rejected draft must never fall back to
    // the original value while the input still shows the rejected text.
    expect(draftToValue(amount, "-5")).toEqual({ ok: false, message: "Enter a valid amount." });
    expect(draftToValue(amount, "not a number")).toEqual({
      ok: false,
      message: "Enter a valid amount.",
    });
    expect(draftToValue({ type: "date", date: "2026-03-14" }, "March 14")).toEqual({
      ok: false,
      message: "Enter a valid date.",
    });
  });
});

describe("deriveMemoryDraft", () => {
  const memory = {
    label: "Paid",
    value: { type: "amount", amount: 42.99, currency: "USD" } as const,
    notes: null,
  };

  it("disables both Apply and Accept while the value input is invalid", () => {
    const draft = deriveMemoryDraft(memory, { label: "Paid", value: "-5", notes: "" });
    expect(draft.canApply).toBe(false);
    expect(draft.canAccept).toBe(false);
    expect(draft.invalidMessage).toBe("Enter a valid amount.");
  });

  it("keeps substance: clearing the value without notes blocks submission", () => {
    const draft = deriveMemoryDraft(memory, { label: "Paid", value: "", notes: "" });
    expect(draft.canApply).toBe(false);
    expect(draft.canAccept).toBe(false);
    expect(draft.invalidMessage).toBeNull();
  });

  it("builds the minimal edit payload for a valid correction", () => {
    const draft = deriveMemoryDraft(memory, { label: "Paid", value: "18.5", notes: "" });
    expect(draft.canApply).toBe(true);
    expect(draft.canAccept).toBe(true);
    expect(draft.buildEdit()).toEqual({
      value: { type: "amount", amount: 18.5, currency: "USD" },
    });
  });
});

describe("interval values (#203)", () => {
  const sixMonths = { type: "interval", interval: 6, unit: "month" } as const;

  it("reads a cadence in the same voice a Routine's chip uses", () => {
    expect(formatAssetMemoryValue(sixMonths)).toBe("Every 6 months");
    expect(formatAssetMemoryValue({ type: "interval", interval: 1, unit: "year" })).toBe(
      "Every year",
    );
  });

  it("round-trips a cadence through its editable draft", () => {
    const draft = valueDraftFor(sixMonths);
    expect(draft).toBe("6 months");
    expect(draftToValue(sixMonths, draft)).toEqual({ ok: true, value: sixMonths });
  });

  it("accepts the singular and a missing space", () => {
    expect(draftToValue(sixMonths, "1 year")).toEqual({
      ok: true,
      value: { type: "interval", interval: 1, unit: "year" },
    });
    expect(draftToValue(sixMonths, "3months")).toEqual({
      ok: true,
      value: { type: "interval", interval: 3, unit: "month" },
    });
  });

  it("refuses a cadence a Routine could not hold, rather than silently clamping it", () => {
    expect(draftToValue(sixMonths, "every so often")).toEqual({
      ok: false,
      message: "Enter an interval like “6 months”.",
    });
    expect(draftToValue(sixMonths, "0 months")).toEqual({
      ok: false,
      message: "Enter an interval like “6 months”.",
    });
    expect(draftToValue(sixMonths, "9999 months")).toEqual({
      ok: false,
      message: "Enter an interval like “6 months”.",
    });
  });
});
