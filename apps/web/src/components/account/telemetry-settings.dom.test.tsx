// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const { setTelemetryOptOutAction } = vi.hoisted(() => ({
  setTelemetryOptOutAction: vi.fn(),
}));

vi.mock("@/app/actions/telemetry", () => ({ setTelemetryOptOutAction }));

import { TelemetrySettings } from "./telemetry-settings";

function box(): HTMLElement {
  return screen.getByRole("checkbox", { name: /Share account analytics and error reports/ });
}

beforeEach(() => {
  setTelemetryOptOutAction.mockReset().mockResolvedValue({ ok: true, view: { optedOut: true } });
});

describe("TelemetrySettings", () => {
  it("shows sharing on for an account that has not opted out, and says what it covers", () => {
    render(<TelemetrySettings optedOut={false} />);

    expect(box().getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Never your notes/)).not.toBeNull();
    expect(box().getAttribute("aria-describedby")).toBeTruthy();
  });

  it("shows sharing off for an account that opted out", () => {
    render(<TelemetrySettings optedOut />);

    expect(box().getAttribute("aria-checked")).toBe("false");
  });

  it("turns sharing off immediately and writes the opt-out", async () => {
    render(<TelemetrySettings optedOut={false} />);

    await userEvent.click(box());

    expect(setTelemetryOptOutAction).toHaveBeenCalledWith({ optedOut: true });
    await waitFor(() => expect(box().getAttribute("aria-checked")).toBe("false"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("puts the box back and says so when the write does not land", async () => {
    setTelemetryOptOutAction.mockResolvedValue({ ok: false, error: "That didn't go through." });
    render(<TelemetrySettings optedOut={false} />);

    await userEvent.click(box());

    await waitFor(() => expect(box().getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByRole("alert").textContent).toBe("That didn't go through.");
  });

  it("puts the box back when the write throws", async () => {
    setTelemetryOptOutAction.mockRejectedValue(new Error("network"));
    render(<TelemetrySettings optedOut />);

    await userEvent.click(box());

    await waitFor(() => expect(box().getAttribute("aria-checked")).toBe("false"));
    expect(screen.getByRole("alert").textContent).toContain("Nothing changed.");
  });

  /**
   * Both quick writes fail: nothing was stored, so the box returns to the
   * stored value rather than to the first click's unconfirmed state.
   */
  it("rolls back to the stored value when two quick writes both fail", async () => {
    const settle: ((outcome: unknown) => void)[] = [];
    setTelemetryOptOutAction.mockImplementation(
      () => new Promise((resolve) => settle.push(resolve)),
    );
    render(<TelemetrySettings optedOut={false} />);

    await userEvent.click(box());
    await userEvent.click(box());

    settle[0]?.({ ok: false, error: "That didn't go through." });
    settle[1]?.({ ok: false, error: "That didn't go through." });

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
    expect(box().getAttribute("aria-checked")).toBe("true");
  });

  /**
   * The first write is stored and the second fails: the box shows what the
   * first stored, even though the first answered before it was the newest.
   */
  it("rolls back to what an earlier write stored when the newest fails", async () => {
    const settle: ((outcome: unknown) => void)[] = [];
    setTelemetryOptOutAction.mockImplementation(
      () => new Promise((resolve) => settle.push(resolve)),
    );
    render(<TelemetrySettings optedOut={false} />);

    await userEvent.click(box());
    await userEvent.click(box());

    settle[0]?.({ ok: true, view: { optedOut: true } });
    settle[1]?.({ ok: false, error: "That didn't go through." });

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
    expect(box().getAttribute("aria-checked")).toBe("false");
  });

  it("keeps the newest choice when an older write answers last", async () => {
    const settle: ((outcome: unknown) => void)[] = [];
    setTelemetryOptOutAction.mockImplementation(
      () => new Promise((resolve) => settle.push(resolve)),
    );
    render(<TelemetrySettings optedOut={false} />);

    await userEvent.click(box());
    await userEvent.click(box());

    settle[1]?.({ ok: true, view: { optedOut: false } });
    await waitFor(() => expect(box().getAttribute("aria-checked")).toBe("true"));
    settle[0]?.({ ok: true, view: { optedOut: true } });

    await waitFor(() => expect(screen.queryByText("Saving…")).toBeNull());
    expect(box().getAttribute("aria-checked")).toBe("true");
  });
});
