// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { GroupableToolView } from "@/components/assistant-results/registry";
import { renderExpanded } from "@/test/expanded-markup";

vi.mock("next/link", () => import("@/test/next-link-mock"));

import { AssistantToolGroup } from "./assistant-tool-group";

function savedMemory(
  content: string,
  personName: string | null,
  sourceRecordId: string | null = null,
): GroupableToolView {
  return {
    kind: "saved_memory",
    memoryId: `memory-${content.length}`,
    sourceRecordId,
    personId: personName ? "person-1" : null,
    personName,
    content,
  };
}

describe("AssistantToolGroup (collapsed group of same-kind durable records)", () => {
  it("collapses several saved memories into one summary, named by count and person", () => {
    const html = renderExpanded(
      <AssistantToolGroup
        kind="saved_memory"
        views={[
          savedMemory("Plays in a weekend soccer league.", "Mara", "source-1"),
          savedMemory("Allergic to shellfish.", "Mara"),
          savedMemory("Learning to play piano.", "Mara"),
        ]}
      />,
    );

    // The summary leads with a plural count and the shared person, and the trust
    // language survives the fold (grounded because one memory cites a source).
    expect(html).toContain("Saved 3 memories");
    expect(html).toContain("Mara");
    expect(html).toContain("Confirmed facts");
    expect(html).toContain("grounded in source records");
    // Each memory's content is present (expanded body), but a shared person is not
    // repeated per row — it rides the summary instead.
    expect(html).toContain("Plays in a weekend soccer league.");
    expect(html).toContain("Allergic to shellfish.");
    expect(html).toContain("Learning to play piano.");
    expect(html).toContain('data-tool-view="saved_memory_group"');
  });

  it("prefixes each row with its person when a memory group spans several people", () => {
    const html = renderExpanded(
      <AssistantToolGroup
        kind="saved_memory"
        views={[
          savedMemory("Moving to Denver.", "Caleb"),
          savedMemory("Started a new job.", "Mara"),
        ]}
      />,
    );

    expect(html).toContain("Saved 2 memories");
    // No single shared person, so each row carries its own name.
    expect(html).toContain("Caleb");
    expect(html).toContain("Mara");
  });

  it("does not claim source grounding for a memory group with no source records", () => {
    const html = renderExpanded(
      <AssistantToolGroup
        kind="saved_memory"
        views={[savedMemory("A fact.", "Mara"), savedMemory("Another fact.", "Mara")]}
      />,
    );

    expect(html).toContain("Confirmed facts");
    expect(html).not.toContain("grounded in source records");
  });

  it("renders a logged-notes group as logged context, not confirmed facts", () => {
    const html = renderExpanded(
      <AssistantToolGroup
        kind="saved_source_record"
        views={[
          {
            kind: "saved_source_record",
            sourceRecordId: "s1",
            content: "Lunch with Mark.",
            linkedPersonId: "p1",
          },
          {
            kind: "saved_source_record",
            sourceRecordId: "s2",
            content: "Coffee with Ana.",
            linkedPersonId: "p2",
          },
        ]}
      />,
    );

    expect(html).toContain("Logged 2 notes");
    expect(html).toContain("You noted");
    expect(html).toContain("Not confirmed facts");
    // Never the saved-memory footer, which is the one place "Confirmed facts" is claimed.
    expect(html).not.toContain(">Confirmed facts");
    expect(html).toContain('data-tool-view="saved_source_record_group"');
  });
});
