// @vitest-environment jsdom

import type { ContextFactView } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const createSelfContextFactAction = vi.fn();
const updateSelfContextFactAction = vi.fn();
const archiveSelfContextFactAction = vi.fn();
const restoreSelfContextFactAction = vi.fn();
const deleteSelfContextFactAction = vi.fn();
const acceptSuggestedContextFactAction = vi.fn();
const dismissSuggestedContextFactAction = vi.fn();

vi.mock("@/app/actions/context-facts", () => ({
  createSelfContextFactAction: (...args: unknown[]) => createSelfContextFactAction(...args),
  updateSelfContextFactAction: (...args: unknown[]) => updateSelfContextFactAction(...args),
  archiveSelfContextFactAction: (...args: unknown[]) => archiveSelfContextFactAction(...args),
  restoreSelfContextFactAction: (...args: unknown[]) => restoreSelfContextFactAction(...args),
  deleteSelfContextFactAction: (...args: unknown[]) => deleteSelfContextFactAction(...args),
}));

vi.mock("@/app/actions/context-fact-review", () => ({
  acceptSuggestedContextFactAction: (...args: unknown[]) =>
    acceptSuggestedContextFactAction(...args),
  dismissSuggestedContextFactAction: (...args: unknown[]) =>
    dismissSuggestedContextFactAction(...args),
}));

// The category and sensitivity fields are Radix `Select`s, which reach for pointer
// capture and scroll positioning that jsdom does not implement.
HTMLElement.prototype.scrollIntoView ??= vi.fn();
HTMLElement.prototype.hasPointerCapture ??= vi.fn();
HTMLElement.prototype.releasePointerCapture ??= vi.fn();

import { AboutYouSurface } from "./about-you-surface";

const FACT_ID = "00000000-0000-4000-8000-000000000001";
const UPDATED_FACT_ID = "00000000-0000-4000-8000-000000000002";
const SUGGESTED_FACT_ID = "00000000-0000-4000-8000-000000000005";
const NOW = new Date("2026-08-02T12:00:00.000Z");

function fact(overrides: Partial<ContextFactView> = {}): ContextFactView {
  return {
    id: FACT_ID,
    subject: { kind: "self" },
    category: "work",
    content: "I run a software consultancy.",
    lifecycle: "active",
    sensitivity: "normal",
    provenance: { channel: "account", origin: "direct" },
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

function suggestedReview(
  overrides: Partial<SuggestedContextFactReviewView> = {},
): SuggestedContextFactReviewView {
  return {
    fact: fact({
      id: SUGGESTED_FACT_ID,
      content: "I am based in Chicago.",
      lifecycle: "suggested",
      sensitivity: "sensitive",
      provenance: { channel: "ambient", origin: "ambient" },
      reviewedAt: null,
    }),
    evidence: "The conversation included a Chicago address.",
    activeMatch: null,
    ...overrides,
  };
}

/** Drives a `Select`: open the trigger, then pick the item by its visible label. */
async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  field: string,
  option: string,
) {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  createSelfContextFactAction.mockReset();
  updateSelfContextFactAction.mockReset();
  archiveSelfContextFactAction.mockReset();
  restoreSelfContextFactAction.mockReset();
  deleteSelfContextFactAction.mockReset();
  acceptSuggestedContextFactAction.mockReset();
  dismissSuggestedContextFactAction.mockReset();
});

describe("AboutYouSurface", () => {
  it("keeps suggested facts separate until the authoritative accept result becomes active", async () => {
    const user = userEvent.setup();
    const accepted = fact({
      id: SUGGESTED_FACT_ID,
      content: "The returned active fact.",
      lifecycle: "active",
      sensitivity: "sensitive",
      provenance: { channel: "ambient", origin: "ambient" },
      reviewedAt: NOW,
    });
    acceptSuggestedContextFactAction.mockResolvedValue({
      ok: true,
      view: { fact: accepted, decision: "accepted" },
    });

    render(
      <AboutYouSurface
        acceptSuggestedContextFactAction={acceptSuggestedContextFactAction}
        initialFacts={[]}
        initialSuggestedReviews={[suggestedReview()]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Suggested" })).toBeTruthy();
    expect(screen.getByText("I am based in Chicago.")).toBeTruthy();
    expect(screen.getByText("The conversation included a Chicago address.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Location" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(acceptSuggestedContextFactAction).toHaveBeenCalledWith({
        contextFactId: SUGGESTED_FACT_ID,
        expectedUpdatedAt: NOW.toISOString(),
      }),
    );
    expect(await screen.findByText("The returned active fact.")).toBeTruthy();
    expect(screen.queryByText("The conversation included a Chicago address.")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("accepted into About you");
  });

  it("dismisses a suggestion and restores focus to the account action", async () => {
    const user = userEvent.setup();
    dismissSuggestedContextFactAction.mockResolvedValue({
      ok: true,
      view: { dismissedContextFactId: SUGGESTED_FACT_ID },
    });
    render(
      <AboutYouSurface
        dismissSuggestedContextFactAction={dismissSuggestedContextFactAction}
        initialFacts={[]}
        initialSuggestedReviews={[suggestedReview()]}
      />,
    );

    const dismiss = screen.getByRole("button", { name: "Dismiss suggested fact" });
    await user.click(dismiss);

    await waitFor(() =>
      expect(dismissSuggestedContextFactAction).toHaveBeenCalledWith({
        contextFactId: SUGGESTED_FACT_ID,
        expectedUpdatedAt: NOW.toISOString(),
      }),
    );
    await waitFor(() => expect(screen.queryByText("I am based in Chicago.")).toBeNull());
    expect(screen.getByText("Nothing about you yet.")).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a fact" })),
    );
  });

  it("groups private active facts and adds only the authoritative returned view", async () => {
    const user = userEvent.setup();
    const returned = fact({
      id: UPDATED_FACT_ID,
      category: "interest",
      content: "Returned from the server, not a client projection.",
      updatedAt: new Date("2026-08-02T12:01:00.000Z"),
    });
    createSelfContextFactAction.mockResolvedValue({
      ok: true,
      view: { fact: returned, decision: "created" },
    });

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
    await chooseOption(user, "Category", "Interest");
    await user.type(
      screen.getByRole("textbox", { name: "Fact" }),
      "Client draft that the server will canonicalize.",
    );
    await chooseOption(user, "Sensitivity", "Sensitive");
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
    updateSelfContextFactAction.mockResolvedValue({
      ok: true,
      view: { fact: returned, decision: "updated" },
    });
    render(<AboutYouSurface initialFacts={[fact()]} />);

    await user.click(screen.getByRole("button", { name: "Edit Work fact" }));
    await user.clear(screen.getByRole("textbox", { name: "Fact" }));
    await user.type(screen.getByRole("textbox", { name: "Fact" }), "A client draft");
    await chooseOption(user, "Category", "Preference");
    await chooseOption(user, "Sensitivity", "Restricted");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateSelfContextFactAction).toHaveBeenCalledWith({
        contextFactId: FACT_ID,
        expectedUpdatedAt: NOW.toISOString(),
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
    await waitFor(() => expect(document.activeElement).toBe(content));
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("offers the existing fact as a focused correction path after a conflict", async () => {
    const user = userEvent.setup();
    createSelfContextFactAction.mockResolvedValue({
      ok: false,
      error: "Edit the existing fact instead.",
      focusContextFactId: FACT_ID,
    });
    render(<AboutYouSurface initialFacts={[fact()]} />);

    await user.click(screen.getByRole("button", { name: "Add a fact" }));
    await user.type(screen.getByRole("textbox", { name: "Fact" }), "A conflicting statement.");
    await user.click(screen.getByRole("button", { name: "Save fact" }));

    expect(await screen.findByRole("button", { name: "Edit existing fact" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit existing fact" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Work fact" })),
    );
    expect(screen.queryByRole("heading", { name: "Add a fact" })).toBeNull();
  });
});
