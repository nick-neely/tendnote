// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SuggestedGeneralActionReviewItemView } from "@/lib/eve/tool-result-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM click-through for the in-chat General Action review card (#190, closing the
 * interaction gap #190 explicitly deferred here). #190 proved idempotency at the SSR +
 * server-action layer; this exercises the real thing a user does — clicking Accept /
 * Dismiss — and asserts the click reaches the owner-scoped mutation, the card settles to
 * its resolved state, and (the idempotency guard as felt in the UI) the action controls
 * are gone afterward so a stale card or double-click cannot re-submit.
 */

const accept = vi.fn();
const dismiss = vi.fn();

vi.mock("@/app/actions/suggested-general-actions", () => ({
  acceptSuggestedGeneralActionAction: (input: unknown) => accept(input),
  dismissSuggestedGeneralActionAction: (input: unknown) => dismiss(input),
}));

// next/link needs an app-router context to render in a client tree; the card's footer deep
// links to /actions, so stub it to a plain anchor for these interaction tests.
vi.mock("next/link", () => import("@/test/next-link-mock"));

import { ChatGeneralActionReviewCard } from "./chat-general-action-review-card";

const GENERAL_ACTION_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  accept.mockReset();
  dismiss.mockReset();
});

function item(
  overrides: Partial<SuggestedGeneralActionReviewItemView> = {},
): SuggestedGeneralActionReviewItemView {
  return {
    generalActionId: GENERAL_ACTION_ID,
    title: "Book the campsite for the trip",
    status: "suggested",
    dueLabel: "Jul 15, 2026",
    isRoutine: false,
    recurrenceLabel: null,
    personNames: [],
    visibilityLabel: "Only me",
    ...overrides,
  };
}

describe("ChatGeneralActionReviewCard interaction", () => {
  it("accepts inline: click calls the accept mutation and settles the card to Accepted", async () => {
    accept.mockResolvedValue({
      ok: true,
      view: { generalActionId: GENERAL_ACTION_ID, status: "open" },
    });
    const user = userEvent.setup();
    render(<ChatGeneralActionReviewCard item={item()} />);

    await user.click(screen.getByRole("button", { name: "Accept suggested action" }));

    await waitFor(() =>
      expect(accept).toHaveBeenCalledWith({ generalActionId: GENERAL_ACTION_ID }),
    );
    expect(accept).toHaveBeenCalledTimes(1);
    // Settles in place to the confirmed state.
    expect(await screen.findByText("Added to your list")).toBeTruthy();
    // Idempotency as felt in the UI: the action controls are gone, so a stale card or a
    // second click cannot re-submit the promotion.
    expect(screen.queryByRole("button", { name: "Accept suggested action" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss suggested action" })).toBeNull();
  });

  it("dismisses inline: click calls the dismiss mutation and settles the card to Dismissed", async () => {
    dismiss.mockResolvedValue({
      ok: true,
      view: { generalActionId: GENERAL_ACTION_ID, status: "dismissed" },
    });
    const user = userEvent.setup();
    render(<ChatGeneralActionReviewCard item={item()} />);

    await user.click(screen.getByRole("button", { name: "Dismiss suggested action" }));

    await waitFor(() =>
      expect(dismiss).toHaveBeenCalledWith({ generalActionId: GENERAL_ACTION_ID }),
    );
    expect(await screen.findByText("Dismissed. No action was added.")).toBeTruthy();
    expect(accept).not.toHaveBeenCalled();
  });

  it("surfaces a recoverable error when the mutation fails, keeping the card actionable", async () => {
    accept.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<ChatGeneralActionReviewCard item={item()} />);

    await user.click(screen.getByRole("button", { name: "Accept suggested action" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("You can review it on the Actions page.");
    // Still pending: the action controls remain so the user can retry.
    expect(screen.getByRole("button", { name: "Accept suggested action" })).toBeTruthy();
  });
});
