// @vitest-environment jsdom

import type { ContextFactView } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

vi.mock("@/app/actions/context-fact-review", () => ({
  acceptSuggestedContextFactAction: vi.fn(),
  dismissSuggestedContextFactAction: vi.fn(),
}));

import { SuggestedContextFactReviewCard } from "./suggested-context-fact-review";

const FACT_ID = "00000000-0000-4000-8000-000000000031";
const EXISTING_ID = "00000000-0000-4000-8000-000000000032";
const NOW = new Date("2026-08-02T12:00:00.000Z");

function fact(overrides: Partial<ContextFactView> = {}): ContextFactView {
  return {
    id: FACT_ID,
    subject: { kind: "self" },
    category: "work",
    content: "I run a software consultancy.",
    lifecycle: "suggested",
    sensitivity: "sensitive",
    provenance: { channel: "ambient", origin: "ambient" },
    reviewedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    trust: "untrusted_data",
    authority: "none",
    visibility: "private",
    ...overrides,
  };
}

function review(overrides: Partial<SuggestedContextFactReviewView> = {}) {
  return {
    fact: fact(),
    evidence: "I run a software consultancy.",
    activeMatch: null,
    ...overrides,
  } satisfies SuggestedContextFactReviewView;
}

function renderCard(
  overrides: Partial<React.ComponentProps<typeof SuggestedContextFactReviewCard>> = {},
) {
  const onResolve = vi.fn();
  const onAccepted = vi.fn();
  const acceptAction = vi.fn().mockResolvedValue({
    ok: true,
    view: { fact: fact({ lifecycle: "active", reviewedAt: NOW }), decision: "accepted" },
  });
  const dismissAction = vi.fn().mockResolvedValue({
    ok: true,
    view: { dismissedContextFactId: FACT_ID },
  });
  render(
    <SuggestedContextFactReviewCard
      acceptAction={acceptAction}
      dismissAction={dismissAction}
      onAccepted={onAccepted}
      onResolve={onResolve}
      review={review()}
      {...overrides}
    />,
  );
  return { acceptAction, dismissAction, onAccepted, onResolve };
}

beforeEach(() => vi.clearAllMocks());

describe("SuggestedContextFactReviewCard", () => {
  it("closes its controls when something outside the card holds it inert", () => {
    renderCard({ disabled: true });

    for (const name of ["Accept", "Edit", "Dismiss suggested fact"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("shows the tentative statement, bounded evidence, sensitivity, and no model confidence", () => {
    renderCard();

    expect(screen.getAllByText("I run a software consultancy.")).toHaveLength(2);
    expect(screen.getByText("Supporting evidence")).toBeDefined();
    expect(screen.getByText("Sensitive · Suggested from a conversation")).toBeDefined();
    expect(screen.queryByText(/confidence/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Accept" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(screen.getByRole("button", { name: /Dismiss suggested/i })).toBeDefined();
  });

  it("accepts the authoritative reviewed edit and reports the accepted view", async () => {
    const user = userEvent.setup();
    const { acceptAction, onAccepted, onResolve } = renderCard();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByRole("textbox", { name: "Suggested fact" }));
    await user.type(screen.getByRole("textbox", { name: "Suggested fact" }), "A reviewed wording");
    await user.click(screen.getByRole("button", { name: "Accept edited fact" }));

    await waitFor(() => expect(acceptAction).toHaveBeenCalledTimes(1));
    expect(acceptAction).toHaveBeenCalledWith({
      contextFactId: FACT_ID,
      expectedUpdatedAt: NOW.toISOString(),
      edit: {
        category: "work",
        content: "A reviewed wording",
        sensitivity: "sensitive",
      },
    });
    await waitFor(() =>
      expect(onAccepted).toHaveBeenCalledWith(
        expect.objectContaining({
          lifecycle: "active",
        }),
      ),
    );
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(FACT_ID));
  });

  it("identifies an active duplicate or conflict and offers the focused About you correction path", () => {
    renderCard({
      review: review({
        activeMatch: {
          kind: "conflict",
          fact: fact({
            id: EXISTING_ID,
            lifecycle: "active",
            content: "I work at Northstar.",
            sensitivity: "normal",
          }),
        },
      }),
    });

    expect(screen.getByText(/conflicts with an active fact/i)).toBeDefined();
    expect(screen.getByRole("link", { name: "Edit existing fact" }).getAttribute("href")).toBe(
      `/account/about-you#context-fact-${EXISTING_ID}`,
    );
  });

  it("keeps the review actionable after a failed accept", async () => {
    const user = userEvent.setup();
    const acceptAction = vi.fn().mockResolvedValue({
      ok: false,
      error: "That suggestion changed elsewhere. Refresh the review and try again.",
    });
    renderCard({ acceptAction });

    const accept = screen.getByRole("button", { name: "Accept" });
    await user.click(accept);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("changed elsewhere"),
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeDefined();
    expect(document.activeElement).toBe(accept);
  });
});
