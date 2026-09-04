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
});
