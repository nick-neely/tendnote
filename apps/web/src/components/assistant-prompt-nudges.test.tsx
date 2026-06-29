import type { PromptNudge } from "@tendnote/domain";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssistantPromptNudges } from "./assistant-prompt-nudges";

const NUDGES: PromptNudge[] = [
  {
    id: "s1",
    label: "Follow up after coffee with Maya",
    prompt: "Follow up after coffee with Maya",
    source: "calendar",
  },
  {
    id: "s2",
    label: "Follow up after the standup",
    prompt: "Follow up after the standup with the team",
    source: "calendar",
  },
];

/** Recursively collect the `suggestion` prop from every nested element. */
function collectSuggestions(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectSuggestions);
  }
  if (!isValidElement(node)) {
    return [];
  }
  const props = node.props as { suggestion?: string; children?: ReactNode };
  const here = typeof props.suggestion === "string" ? [props.suggestion] : [];
  return [...here, ...collectSuggestions(props.children)];
}

describe("AssistantPromptNudges", () => {
  it("renders nothing when there are no nudges", () => {
    expect(renderToStaticMarkup(<AssistantPromptNudges nudges={[]} onSelect={vi.fn()} />)).toBe("");
  });

  it("renders the nudge labels under a calendar-sourced heading", () => {
    const html = renderToStaticMarkup(<AssistantPromptNudges nudges={NUDGES} onSelect={vi.fn()} />);
    expect(html).toContain("From your calendar");
    expect(html).toContain("Follow up after coffee with Maya");
    expect(html).toContain("Follow up after the standup");
  });

  it("is not a review surface — no accept/dismiss/edit controls", () => {
    const html = renderToStaticMarkup(<AssistantPromptNudges nudges={NUDGES} onSelect={vi.fn()} />);
    for (const action of ["Accept", "Dismiss", "Save", "<form"]) {
      expect(html).not.toContain(action);
    }
  });

  it("wires each chip to send the PROMPT (not the label) to Eve on click", () => {
    const tree = AssistantPromptNudges({ nudges: NUDGES, onSelect: vi.fn() });
    // Each chip carries the full prompt text as its click payload.
    expect(collectSuggestions(tree)).toEqual([
      "Follow up after coffee with Maya",
      "Follow up after the standup with the team",
    ]);
  });
});
