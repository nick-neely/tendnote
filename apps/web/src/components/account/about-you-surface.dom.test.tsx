// @vitest-environment jsdom

import type { ContextFactView } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const createSelfContextFactAction = vi.fn();
const updateSelfContextFactAction = vi.fn();

vi.mock("@/app/actions/context-facts", () => ({
  createSelfContextFactAction: (...args: unknown[]) => createSelfContextFactAction(...args),
  updateSelfContextFactAction: (...args: unknown[]) => updateSelfContextFactAction(...args),
}));

import { AboutYouSurface } from "./about-you-surface";

const OWNER = "owner-1";
const FACT_ID = "00000000-0000-4000-8000-000000000001";
const UPDATED_FACT_ID = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-08-02T12:00:00.000Z");

function fact(overrides: Partial<ContextFactView> = {}): ContextFactView {
  return {
    id: FACT_ID,
    subject: { kind: "self", userId: OWNER },
    category: "work",
    content: "I run a software consultancy.",
    lifecycle: "active",
    sensitivity: "normal",
    provenance: { channel: "account", origin: "direct", sourceRecordId: null },
    suggestionEvidence: null,
    creatorUserId: OWNER,
    lastActorUserId: OWNER,
    reviewedAt: NOW,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    trust: "untrusted_data",
    authority: "none",
    visibility: "private",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AboutYouSurface", () => {
  it("groups private active facts and adds only the authoritative returned view", async () => {
    const user = userEvent.setup();
    const returned = fact({
      id: UPDATED_FACT_ID,
      category: "interest",
      content: "Returned from the server, not a client projection.",
      updatedAt: new Date("2026-08-02T12:01:00.000Z"),
    });
    createSelfContextFactAction.mockResolvedValue({ ok: true, view: returned });

    render(
      <AboutYouSurface
        initialFacts={[
          fact(),
          fact({
            id: "00000000-0000-4000-8000-000000000003",
            category: "preference",
            content: "I prefer concise answers.",
          }),
          fact({
            id: "00000000-0000-4000-8000-000000000004",
            subject: { kind: "household", householdId: "household-1" },
            category: "other",
            content: "This must stay off About you.",
          }),
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Work" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Preference" })).toBeTruthy();
    expect(screen.queryByText("This must stay off About you.")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /visibility/i })).toBeNull();
    expect(screen.getByText(/private to you/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add a fact" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "interest");
    await user.type(
      screen.getByRole("textbox", { name: "Fact" }),
      "Client draft that the server will canonicalize.",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Sensitivity" }), "sensitive");
    await user.click(screen.getByRole("button", { name: "Save fact" }));

    await waitFor(() =>
      expect(createSelfContextFactAction).toHaveBeenCalledWith({
        category: "interest",
        content: "Client draft that the server will canonicalize.",
        sensitivity: "sensitive",
      }),
    );
    expect(await screen.findByText(returned.content)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Fact added");
  });

  it("edits an existing fact through the returned view without exposing an owner field", async () => {
    const user = userEvent.setup();
    const returned = fact({
      category: "preference",
      content: "The authoritative replacement.",
      sensitivity: "restricted",
      updatedAt: new Date("2026-08-02T12:02:00.000Z"),
    });
    updateSelfContextFactAction.mockResolvedValue({ ok: true, view: returned });
    render(<AboutYouSurface initialFacts={[fact()]} />);

    await user.click(screen.getByRole("button", { name: "Edit Work fact" }));
    await user.clear(screen.getByRole("textbox", { name: "Fact" }));
    await user.type(screen.getByRole("textbox", { name: "Fact" }), "A client draft");
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "preference");
    await user.selectOptions(screen.getByRole("combobox", { name: "Sensitivity" }), "restricted");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateSelfContextFactAction).toHaveBeenCalledWith({
        contextFactId: FACT_ID,
        category: "preference",
        content: "A client draft",
        sensitivity: "restricted",
      }),
    );
    expect(await screen.findByText(returned.content)).toBeTruthy();
    expect(screen.queryByText("A client draft")).toBeNull();
    expect(screen.queryByRole("textbox", { name: /owner/i })).toBeNull();
  });

  it("preserves editable input and restores focus on a failed save", async () => {
    const user = userEvent.setup();
    createSelfContextFactAction.mockRejectedValue(new Error("database unavailable"));
    render(<AboutYouSurface initialFacts={[]} />);

    await user.click(screen.getByRole("button", { name: "Add a fact" }));
    const content = screen.getByRole("textbox", { name: "Fact" });
    await user.type(content, "Keep this draft while retrying.");
    await user.click(screen.getByRole("button", { name: "Save fact" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect((content as HTMLTextAreaElement).value).toBe("Keep this draft while retrying.");
    expect(document.activeElement).toBe(content);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
