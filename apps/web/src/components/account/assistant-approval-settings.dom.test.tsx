// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const { setEveApprovalModeAction } = vi.hoisted(() => ({
  setEveApprovalModeAction: vi.fn(),
}));

// The control's write reaches `server-only` through the action module chain.
vi.mock("@/app/actions/eve-approvals", () => ({ setEveApprovalModeAction }));

import { AssistantApprovalSettings } from "./assistant-approval-settings";

const TAINT_NOTE =
  "Reading web content in a conversation turns approvals back on for that conversation.";

function radio(name: RegExp): HTMLElement {
  return screen.getByRole("radio", { name });
}

function checked(name: RegExp): string | null {
  return radio(name).getAttribute("aria-checked");
}

beforeEach(() => {
  setEveApprovalModeAction.mockReset().mockResolvedValue({ ok: true, view: { mode: "trusted" } });
});

describe("AssistantApprovalSettings", () => {
  it("shows the stored mode as the selected choice", () => {
    render(<AssistantApprovalSettings mode="trusted" />);

    expect(checked(/Trusted/)).toBe("true");
    expect(checked(/Ask every time/)).toBe("false");
  });

  /**
   * The note is not conditional on the current selection: it says what Trusted
   * means, which an owner needs while deciding rather than afterwards.
   */
  it("stands the Tainted Conversation note under Trusted whichever mode is selected", () => {
    render(<AssistantApprovalSettings mode="ask" />);

    expect(screen.getByText(TAINT_NOTE)).not.toBeNull();
  });

  it("moves to Trusted immediately and writes the owner's choice", async () => {
    render(<AssistantApprovalSettings mode="ask" />);

    await userEvent.click(radio(/Trusted/));

    expect(setEveApprovalModeAction).toHaveBeenCalledWith({ mode: "trusted" });
    await waitFor(() => expect(checked(/Trusted/)).toBe("true"));
    expect(screen.getByText(TAINT_NOTE)).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("puts the selection back and says so when the write does not land", async () => {
    setEveApprovalModeAction.mockResolvedValue({ ok: false, error: "That didn't go through." });
    render(<AssistantApprovalSettings mode="ask" />);

    await userEvent.click(radio(/Trusted/));

    await waitFor(() => expect(checked(/Ask every time/)).toBe("true"));
    expect(checked(/Trusted/)).toBe("false");
    expect(screen.getByRole("alert").textContent).toBe("That didn't go through.");
  });

  it("puts the selection back when the write throws rather than answering", async () => {
    setEveApprovalModeAction.mockRejectedValue(new Error("network"));
    render(<AssistantApprovalSettings mode="trusted" />);

    await userEvent.click(radio(/Ask every time/));

    await waitFor(() => expect(checked(/Trusted/)).toBe("true"));
    expect(screen.getByRole("alert").textContent).toContain("Nothing changed.");
  });

  it("writes nothing when the owner re-picks the mode they already have", async () => {
    render(<AssistantApprovalSettings mode="trusted" />);

    await userEvent.click(radio(/Trusted/));

    expect(setEveApprovalModeAction).not.toHaveBeenCalled();
  });

  /**
   * Arrow keys walk a radio group, so two writes inside one round trip is an
   * ordinary thing to do. The responses can then come back in either order, and
   * an older one applying its result last would leave the page showing a mode the
   * owner has already moved off.
   */
  it("keeps the newest choice when an older write answers last", async () => {
    const settle: ((outcome: unknown) => void)[] = [];
    setEveApprovalModeAction.mockImplementation(
      () => new Promise((resolve) => settle.push(resolve)),
    );
    render(<AssistantApprovalSettings mode="ask" />);

    await userEvent.click(radio(/Trusted/));
    await userEvent.click(radio(/Ask every time/));

    expect(setEveApprovalModeAction).toHaveBeenNthCalledWith(1, { mode: "trusted" });
    expect(setEveApprovalModeAction).toHaveBeenNthCalledWith(2, { mode: "ask" });

    // The newest answers first, and the older one lands after it.
    settle[1]?.({ ok: true, view: { mode: "ask" } });
    await waitFor(() => expect(checked(/Ask every time/)).toBe("true"));
    settle[0]?.({ ok: true, view: { mode: "trusted" } });

    await waitFor(() => expect(screen.queryByText("Saving…")).toBeNull());
    expect(checked(/Ask every time/)).toBe("true");
    expect(checked(/Trusted/)).toBe("false");
  });

  /** A superseded failure is not this page's answer either, and says nothing. */
  it("neither rolls back nor complains when an older write fails last", async () => {
    const settle: ((outcome: unknown) => void)[] = [];
    setEveApprovalModeAction.mockImplementation(
      () => new Promise((resolve) => settle.push(resolve)),
    );
    render(<AssistantApprovalSettings mode="ask" />);

    await userEvent.click(radio(/Trusted/));
    await userEvent.click(radio(/Ask every time/));

    settle[1]?.({ ok: true, view: { mode: "ask" } });
    await waitFor(() => expect(checked(/Ask every time/)).toBe("true"));
    settle[0]?.({ ok: false, error: "That didn't go through." });

    await waitFor(() => expect(screen.queryByText("Saving…")).toBeNull());
    expect(checked(/Ask every time/)).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * The status line holds its row while it is empty. A line that appears and
   * disappears with the round trip would push the sections under it down and pull
   * them back while the owner is only picking a radio button.
   */
  it("keeps the status line in place while nothing is saving", async () => {
    const settle: ((outcome: unknown) => void)[] = [];
    setEveApprovalModeAction.mockImplementation(
      () => new Promise((resolve) => settle.push(resolve)),
    );
    render(<AssistantApprovalSettings mode="ask" />);

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");

    await userEvent.click(radio(/Trusted/));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saving…"));

    settle[0]?.({ ok: true, view: { mode: "trusted" } });

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(""));
    // The same element throughout: it was never unmounted and remounted, so the
    // sections under it never moved.
    expect(screen.getByRole("status")).toBe(status);
  });
});
