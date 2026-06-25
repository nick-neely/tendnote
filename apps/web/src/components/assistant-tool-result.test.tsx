import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";
import { AssistantToolResult } from "./assistant-tool-result";

function render(view: AssistantToolView): string {
  return renderToStaticMarkup(<AssistantToolResult view={view} />);
}

describe("AssistantToolResult (persisted Eve tool result rendering)", () => {
  it("renders a saved source record as logged context, not a confirmed fact", () => {
    const html = render({
      kind: "saved_source_record",
      sourceRecordId: "source-1",
      content: "Had lunch with Mark.",
      linkedPersonId: "person-1",
    });

    expect(html).toContain("Logged");
    expect(html).toContain("You noted");
    expect(html).toContain("Had lunch with Mark.");
    expect(html).toContain("not a confirmed fact");
    expect(html).toContain('data-tool-view="saved_source_record"');
  });

  it("renders a saved memory as a confirmed fact", () => {
    const html = render({
      kind: "saved_memory",
      memoryId: "memory-1",
      sourceRecordId: "source-1",
      personId: "person-1",
      personName: "Caleb",
      content: "Caleb is moving to Denver in August.",
    });

    expect(html).toContain("Saved to memory");
    expect(html).toContain("Confirmed fact");
    expect(html).toContain("grounded in a source record");
    expect(html).toContain("Caleb is moving to Denver in August.");
  });

  it("does not claim source-record provenance when the memory has none", () => {
    const html = render({
      kind: "saved_memory",
      memoryId: "memory-1",
      sourceRecordId: null,
      personId: null,
      personName: null,
      content: "A standalone fact.",
    });

    expect(html).toContain("Confirmed fact");
    expect(html).not.toContain("grounded in a source record");
  });

  it("renders a suggested memory as tentative review-needed, never asserted as fact", () => {
    const html = render({
      kind: "suggested_memory_review",
      memoryId: "memory-2",
      content: "Maybe switching jobs.",
      sourceRecordId: "source-2",
    });

    expect(html).toContain("Ready to review");
    expect(html).toContain("Tentative");
    expect(html).toContain("Maybe switching jobs.");
  });

  it("renders person context with per-tier counts and snapshot status", () => {
    const html = render({
      kind: "person_context",
      personId: "person-1",
      personName: "Mark",
      snapshotStatus: "fresh",
      approvedCount: 1,
      loggedCount: 2,
      suggestedCount: 1,
    });

    expect(html).toContain("Mark");
    expect(html).toContain("1 confirmed");
    expect(html).toContain("2 logged");
    expect(html).toContain("1 to review");
    expect(html).toContain("snapshot fresh");
  });

  it("renders an unknown tool result as a quiet generic confirmation", () => {
    const html = render({ kind: "generic", toolName: "some_future_tool" });

    expect(html).toContain("Done");
    expect(html).toContain("some future tool");
  });
});
