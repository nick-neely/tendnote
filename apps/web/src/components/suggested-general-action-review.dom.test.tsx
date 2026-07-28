// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generalActionViewFixture } from "@/components/general-action-fixtures";
import type { SuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM click-through for the Actions-surface Suggested General Action review card
 * (#182/#185), previously proven only at the SSR + server-action layer. This drives the
 * real review gestures — Accept and the inline Edit → Apply — and asserts each click reaches
 * the owner-scoped review mutation and, for accept, calls back to leave the surface's list.
 */

const accept = vi.fn();
const dismiss = vi.fn();
const ignore = vi.fn();
const edit = vi.fn();
const restore = vi.fn();

vi.mock("@/app/actions/suggested-general-actions", () => ({
  acceptSuggestedGeneralActionAction: (input: unknown) => accept(input),
  dismissSuggestedGeneralActionAction: (input: unknown) => dismiss(input),
  ignoreSuggestedGeneralActionAction: (input: unknown) => ignore(input),
  editSuggestedGeneralActionAction: (input: unknown) => edit(input),
  restoreDismissedSuggestedGeneralActionAction: (input: unknown) => restore(input),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

import { SuggestedGeneralActionReviewCard } from "./suggested-general-action-review";

const ACTION_ID = "11111111-1111-1111-1111-111111111111";

function view(): SuggestedGeneralActionReviewView {
  return {
    component: {
      type: "suggested_general_action_review",
      generalActionId: ACTION_ID,
      sourceRecordId: "22222222-2222-2222-2222-222222222222",
    },
    action: generalActionViewFixture({
      id: ACTION_ID,
      title: "Replace the water filter",
      status: "suggested",
    }),
    areaName: "Home",
    source: null,
  };
}

beforeEach(() => {
  accept.mockReset();
  dismiss.mockReset();
  ignore.mockReset();
  edit.mockReset();
  restore.mockReset();
  refresh.mockReset();
});

describe("SuggestedGeneralActionReviewCard interaction", () => {
  it("accepts: click promotes through the accept mutation and leaves the list", async () => {
    accept.mockResolvedValue({ ok: true, view: { status: "open" } });
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(<SuggestedGeneralActionReviewCard onResolve={onResolve} review={view()} />);

    await user.click(screen.getByRole("button", { name: /^Accept$/ }));

    await waitFor(() =>
      expect(accept).toHaveBeenCalledWith({ generalActionId: ACTION_ID, edit: {} }),
    );
    expect(refresh).toHaveBeenCalled();
    // The card leaves the surface's list after its exit transition.
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(ACTION_ID));
  });

  it("edits in place: opening Edit, changing the title, and applying calls the edit mutation", async () => {
    const updated = {
      ...view(),
      action: generalActionViewFixture({ id: ACTION_ID, title: "Replace the HVAC filter" }),
    };
    edit.mockResolvedValue({ ok: true, view: updated });
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(
      <SuggestedGeneralActionReviewCard onResolve={vi.fn()} onUpdate={onUpdate} review={view()} />,
    );

    await user.click(screen.getByRole("button", { name: /^Edit$/ }));

    const titleInput = await screen.findByLabelText("Action title");
    await user.clear(titleInput);
    await user.type(titleInput, "Replace the HVAC filter");
    await user.click(screen.getByRole("button", { name: "Apply edit" }));

    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith({
        generalActionId: ACTION_ID,
        edit: { title: "Replace the HVAC filter" },
      }),
    );
    expect(onUpdate).toHaveBeenCalledWith(updated);
    // Accept was never fired by the edit path — an edit is not a promotion.
    expect(accept).not.toHaveBeenCalled();
  });

  it("surfaces a recoverable error when accept fails, leaving the card in place", async () => {
    accept.mockRejectedValue(new Error("network"));
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(<SuggestedGeneralActionReviewCard onResolve={onResolve} review={view()} />);

    await user.click(screen.getByRole("button", { name: /^Accept$/ }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onResolve).not.toHaveBeenCalled();
  });
});
