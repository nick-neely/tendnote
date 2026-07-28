// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const actions = vi.hoisted(() => ({
  archive: vi.fn(),
  dismiss: vi.fn(),
  edit: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/app/actions/memory-review", () => ({
  archiveSuggestedMemoryAction: actions.archive,
  dismissSuggestedMemoryAction: actions.dismiss,
  editSuggestedMemoryAction: actions.edit,
  restoreDismissedSuggestedMemoryAction: actions.restore,
  saveSuggestedMemoryAction: actions.save,
}));

import { SuggestedMemoryReviewSection } from "./suggested-memory-review";

const review = {
  component: {
    type: "suggested_memory_review" as const,
    memoryId: "memory-1",
    sourceRecordId: "source-1",
  },
  personName: "Maya",
  memory: {
    id: "memory-1",
    personId: "person-1",
    content: "Maya prefers an early dinner.",
    status: "suggested",
    memoryType: "preference" as const,
    sensitivity: "normal" as const,
    confidence: "medium",
    importance: 3,
    createdAt: "2026-07-28T12:00:00.000Z",
  },
  source: {
    id: "source-1",
    content: "Dinner is easiest around five.",
    sourceType: "manual",
    sensitivity: "normal" as const,
    capturedAt: "2026-07-28T12:00:00.000Z",
  },
};

describe("SuggestedMemoryReviewSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.dismiss.mockResolvedValue({ ok: true, view: review });
    actions.restore.mockResolvedValue({ ok: true, view: review });
    actions.save.mockResolvedValue({ ok: true, view: review });
  });

  it("dismisses with authoritative Undo through the shared mutation module", async () => {
    const user = userEvent.setup();
    render(<SuggestedMemoryReviewSection initialReviews={[review]} />);

    await user.click(screen.getByRole("button", { name: "Dismiss suggestion" }));
    await user.click(await screen.findByRole("button", { name: "Undo Dismiss" }));

    await waitFor(() =>
      expect(actions.restore).toHaveBeenCalledWith({ memoryId: review.memory.id }),
    );
    expect(screen.getByText(review.memory.content)).toBeTruthy();
  });

  it("shows visible pending feedback and aria-busy while a review command settles", async () => {
    const user = userEvent.setup();
    let settle: (result: { ok: true; view: typeof review }) => void = () => {};
    actions.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    render(<SuggestedMemoryReviewSection initialReviews={[review]} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    const card = document.querySelector<HTMLElement>("[data-memory-id='memory-1']");
    expect(card?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getAllByText("Updating suggested memory…").length).toBeGreaterThan(0);

    settle({ ok: true, view: review });
    await waitFor(() => expect(card?.getAttribute("aria-busy")).toBe("false"));
  });
});
