// @vitest-environment jsdom
import type { SharedRelationshipRecordView } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { render, screen } from "@/test/dom";
import {
  SharedRelationshipRecord,
  SharedRelationshipRecordUnavailable,
} from "./shared-relationship-record";

function view(overrides: Partial<SharedRelationshipRecordView> = {}): SharedRelationshipRecordView {
  return {
    recordKind: "memory",
    recordId: "memory-1",
    body: "Prefers tea over coffee.",
    personLabel: "Ada",
    recordedAt: new Date("2026-05-01T00:00:00Z"),
    dueAt: null,
    trust: "high",
    sharedByName: "Mara",
    audience: "whole_household",
    viewerIsOwner: false,
    ...overrides,
  };
}

describe("a shared record on its own page", () => {
  it("shows the record, who it is about, and who shared it", () => {
    render(<SharedRelationshipRecord view={view()} />);

    expect(screen.getByText("Prefers tea over coffee.")).toBeTruthy();
    expect(screen.getByText("Memory about Ada")).toBeTruthy();
    expect(screen.getByText("Shared by Mara")).toBeTruthy();
  });

  it("names the audience in words, not only a glyph", () => {
    render(<SharedRelationshipRecord view={view()} />);
    expect(screen.getByText("Whole household")).toBeTruthy();
  });

  it("names a selected-member share Specific people when the count is not on the view", () => {
    render(<SharedRelationshipRecord view={view({ audience: "selected_members" })} />);
    expect(screen.getByText("Specific people")).toBeTruthy();
    expect(screen.queryByText("Whole household")).toBeNull();
  });

  it("names a shared note without naming a person", () => {
    render(
      <SharedRelationshipRecord
        view={view({ recordKind: "source_record", personLabel: null, body: "Coffee on Tuesday." })}
      />,
    );

    expect(screen.getByText("Note")).toBeTruthy();
    expect(screen.queryByText(/about/)).toBeNull();
  });

  it("carries a follow-up's timing", () => {
    render(
      <SharedRelationshipRecord
        view={view({
          recordKind: "followup",
          trust: null,
          dueAt: new Date("2026-06-10T00:00:00Z"),
        })}
      />,
    );

    expect(screen.getByText(/due/)).toBeTruthy();
    expect(screen.queryByText(/confidence/)).toBeNull();
  });

  /**
   * The anti-dossier assertions. A page that offered any of these would turn one
   * deliberately shared fact into a profile of the person it is about.
   */
  it("offers nothing to act on, and no way further in", () => {
    const { container } = render(<SharedRelationshipRecord view={view()} />);

    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("form")).toHaveLength(0);
  });

  it("says plainly that the record stays its owner's", () => {
    render(<SharedRelationshipRecord view={view()} />);
    expect(screen.getByText(/stays Mara’s to edit or take back/)).toBeTruthy();
  });

  /**
   * A short record on a phone can be read and left without ever reaching the
   * footer, so the read-only contract has to be legible at the point of arrival
   * as well as at the end.
   */
  it("states the read-only contract where the reader arrives", () => {
    render(<SharedRelationshipRecord view={view()} />);
    expect(screen.getByText(/Yours to read, not to change/)).toBeTruthy();
  });

  it("does not tell the owner their own record was shared by someone", () => {
    render(<SharedRelationshipRecord view={view({ viewerIsOwner: true })} />);

    expect(screen.getByText("Shared by you")).toBeTruthy();
    expect(screen.queryByText(/to edit or take back/)).toBeNull();
    // Nor lecture them about their own record being read-only.
    expect(screen.queryByText(/Yours to read/)).toBeNull();
    // An owner may be reaching a still-private record; do not invent an audience.
    expect(screen.queryByText("Whole household")).toBeNull();
    expect(screen.queryByText("Specific people")).toBeNull();
  });
});

describe("when it is out of reach", () => {
  it("says one thing, and nothing about what was refused", () => {
    const { container } = render(<SharedRelationshipRecordUnavailable />);

    expect(screen.getByRole("heading", { name: /no longer available/ })).toBeTruthy();
    const markup = container.innerHTML;
    for (const disclosure of ["memory", "household", "member", "permission", "removed"]) {
      expect(markup.toLowerCase()).not.toContain(disclosure);
    }
  });
});
