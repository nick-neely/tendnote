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
});
