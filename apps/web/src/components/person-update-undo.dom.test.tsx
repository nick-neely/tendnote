// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";
import { PersonUpdateUndo } from "./person-update-undo";

const actions = vi.hoisted(() => ({
  undoPersonUpdateAction: vi.fn(),
  getPersonUpdateStatusAction: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/person-updates", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/link", () => import("@/test/next-link-mock"));
const update = {
  target: {
    personId: "11111111-1111-4111-8111-111111111111",
    updateId: "22222222-2222-4222-8222-222222222222",
  },
  changes: [{ field: "birthday" as const, before: "1989-03-03", after: null }],
};
beforeEach(() => {
  vi.clearAllMocks();
  actions.getPersonUpdateStatusAction.mockResolvedValue({
    ok: true,
    view: { status: "available" },
  });
});
describe("person update recovery", () => {
  it("shows the exact birthday change and restores directly with the stored target", async () => {
    actions.undoPersonUpdateAction.mockResolvedValue({ ok: true, view: { status: "applied" } });
    render(<PersonUpdateUndo update={update} />);
    expect(screen.getByText("March 3, 1989")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Undo last update" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Update undone"));
    expect(actions.undoPersonUpdateAction).toHaveBeenCalledWith(update.target);
    expect(refresh).toHaveBeenCalled();
  });
  it("keeps a pending click single-flight and reports a superseded edit", async () => {
    let settle!: (value: unknown) => void;
    actions.undoPersonUpdateAction.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(<PersonUpdateUndo inConversation update={update} />);
    await userEvent.click(screen.getByRole("button", { name: /^Undo$/ }));
    expect(screen.getByRole("button", { name: "Undoing…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("link", { name: "View person" }).getAttribute("href")).toBe(
      `/people/${update.target.personId}`,
    );
    settle({ ok: true, view: { status: "superseded" } });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("This profile changed again"),
    );
    expect(actions.undoPersonUpdateAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("allows an ambiguous network failure to retry the same target safely", async () => {
    actions.undoPersonUpdateAction
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, view: { status: "already_undone" } });
    render(<PersonUpdateUndo update={update} />);
    await userEvent.click(screen.getByRole("button", { name: "Undo last update" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Couldn't confirm"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry undo" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("already undone"));
    expect(actions.undoPersonUpdateAction.mock.calls).toEqual([[update.target], [update.target]]);
  });

  it.each(["already_undone", "superseded", "unavailable"])(
    "reconciles a revisited card as %s",
    async (status) => {
      actions.getPersonUpdateStatusAction.mockResolvedValue({ ok: true, view: { status } });
      render(<PersonUpdateUndo update={update} />);
      await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
      expect(actions.undoPersonUpdateAction).not.toHaveBeenCalled();
    },
  );
});
