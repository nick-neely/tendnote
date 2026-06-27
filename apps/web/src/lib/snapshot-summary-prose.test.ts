import { describe, expect, it } from "vitest";
import { sanitizeSnapshotSummary } from "./snapshot-summary-prose";

describe("sanitizeSnapshotSummary", () => {
  it("leaves clean prose untouched", () => {
    const prose =
      "A close friend you met in 2019. Works as a nurse at the regional hospital.\n\nYou both volunteer at the same trail cleanup each spring.";
    expect(sanitizeSnapshotSummary(prose)).toBe(prose);
  });

  it("drops a leading heading that duplicates the page header", () => {
    const input = "# Mara\n\nA close friend since 2019. Reliable and direct.";
    const result = sanitizeSnapshotSummary(input);

    expect(result).not.toContain("#");
    expect(result).toBe("A close friend since 2019. Reliable and direct.");
  });

  it("drops a leading heading and a bold relationship/role label", () => {
    const input =
      "# Mara Quinn\n\n**Colleague | Product Lead**\n\nMara values structure and clarity.";
    const result = sanitizeSnapshotSummary(input);

    expect(result).toBe("Mara values structure and clarity.");
    expect(result).not.toMatch(/[#*]/);
  });

  it("flattens inline emphasis, code, and links to plain text", () => {
    const input =
      "You noted **Mara** is a *careful* planner who lives near the `old` [town square](https://x.test).";
    expect(sanitizeSnapshotSummary(input)).toBe(
      "You noted Mara is a careful planner who lives near the old town square.",
    );
  });

  it("converts unordered list markers to bullets without leaking dashes", () => {
    const input = "Pets to remember:\n- Pepper\n- Sage\n- Mochi";
    expect(sanitizeSnapshotSummary(input)).toBe("Pets to remember:\n• Pepper\n• Sage\n• Mochi");
  });

  it("strips blockquotes and horizontal rules", () => {
    const input = "First line.\n\n---\n\n> Quoted aside.";
    expect(sanitizeSnapshotSummary(input)).toBe("First line.\n\nQuoted aside.");
  });

  it("collapses runs of blank lines to a single paragraph break", () => {
    const input = "Para one.\n\n\n\nPara two.";
    expect(sanitizeSnapshotSummary(input)).toBe("Para one.\n\nPara two.");
  });

  it("leaves snake_case words alone", () => {
    const input = "The field is named first_name in the export.";
    expect(sanitizeSnapshotSummary(input)).toBe("The field is named first_name in the export.");
  });

  it("returns an empty string when only chrome remains", () => {
    expect(sanitizeSnapshotSummary("# Mara\n\n**Partner**")).toBe("");
  });
});
