// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, userEvent } from "@/test/dom";
import { DatePicker, DateTimePicker, toDateTimeValue, toDateValue } from "./date-picker";

/**
 * These two replace thirteen native `<input type="date">` / `datetime-local`
 * call sites, so the contract that matters is the string that leaves them: the
 * same `yyyy-mm-dd` / `yyyy-mm-ddThh:mm` the native controls produced. What
 * follows pins that contract, plus the label association and clearing the
 * native controls gave away for free.
 */

/** The day button for a `yyyy-mm-dd` date in the open calendar (portaled to body). */
function dayButton(date: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-day="${date}"] button`);
  if (!button) throw new Error(`no day button for ${date}`);
  return button;
}

/** The same day-of-month in whichever month the calendar opens on by default. */
function dayThisMonth(day: number, base = new Date()): string {
  return toDateValue(new Date(base.getFullYear(), base.getMonth(), day));
}

function trigger(name: string): HTMLElement {
  return screen.getByRole("combobox", { name });
}

describe("DatePicker", () => {
  it("shows a quiet placeholder until a date is set", () => {
    render(<DatePicker aria-label="Due date" value="" />);

    expect(trigger("Due date").textContent).toBe("Pick a date");
  });

  it("renders a set date in plain words", () => {
    render(<DatePicker aria-label="Due date" value="2026-07-15" />);

    expect(trigger("Due date").textContent).toBe("Jul 15, 2026");
  });

  it("associates with a label through id, so a click opens the picker", async () => {
    const user = userEvent.setup();
    render(
      <>
        <label htmlFor="due">Due date</label>
        <DatePicker id="due" value="" />
      </>,
    );

    await user.click(screen.getByText("Due date"));

    expect(screen.getByRole("grid")).toBeDefined();
  });

  it("emits yyyy-mm-dd when a day is picked, and closes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker aria-label="Due date" onChange={onChange} value="2026-07-15" />);

    await user.click(trigger("Due date"));
    await user.click(dayButton("2026-07-20"));

    expect(onChange).toHaveBeenCalledWith("2026-07-20");
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("keeps the value when the selected day is re-picked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker aria-label="Due date" onChange={onChange} value="2026-07-15" />);

    await user.click(trigger("Due date"));
    await user.click(dayButton("2026-07-15"));

    // react-day-picker treats a re-pick as a deselect. Clearing belongs to the
    // explicit control, so this confirms and closes instead of emptying.
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger("Due date").textContent).toBe("Jul 15, 2026");
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("clears to an empty string", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker aria-label="Due date" onChange={onChange} value="2026-07-15" />);

    await user.click(screen.getByRole("button", { name: "Clear date" }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("offers no clear control while empty", () => {
    render(<DatePicker aria-label="Due date" value="" />);

    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull();
  });

  it("tracks its own value when the call site does not own one", async () => {
    const user = userEvent.setup();
    render(<DatePicker aria-label="Due date" defaultValue="2026-07-15" />);

    await user.click(trigger("Due date"));
    await user.click(dayButton("2026-07-20"));

    expect(trigger("Due date").textContent).toBe("Jul 20, 2026");
  });

  it("posts through a hidden input so plain FormData submits keep working", () => {
    const { container } = render(<DatePicker defaultValue="2026-07-15" name="purchasedOn" />);

    const hidden = container.querySelector<HTMLInputElement>('input[name="purchasedOn"]');

    expect(hidden?.value).toBe("2026-07-15");
  });

  /**
   * Thumb-first surfaces need the 44px target the native control had. It is a
   * prop rather than a call-site override so nobody has to reach past the trigger
   * with a `[data-slot=...]` selector to get one.
   */
  it("stands at the touch target when asked, and at field height otherwise", () => {
    const { rerender } = render(<DatePicker aria-label="Due date" size="touch" />);
    expect(trigger("Due date").className).toContain("h-11");

    rerender(<DatePicker aria-label="Due date" />);
    expect(trigger("Due date").className).toContain("h-8");
  });

  it("refuses days outside min", async () => {
    const user = userEvent.setup();
    render(<DatePicker aria-label="Due date" min="2026-07-15" value="2026-07-15" />);

    await user.click(trigger("Due date"));

    expect(dayButton("2026-07-14").disabled).toBe(true);
    expect(dayButton("2026-07-16").disabled).toBe(false);
  });
});

describe("DateTimePicker", () => {
  it("splits an existing value across the two fields", () => {
    render(<DateTimePicker aria-label="Bring back" value="2026-07-15T14:30" />);

    expect(trigger("Bring back").textContent).toBe("Jul 15, 2026");
    expect(screen.getByLabelText<HTMLInputElement>("Time").value).toBe("14:30");
  });

  it("fills a calm default time when only a date is picked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const chosenDate = dayThisMonth(20);
    render(<DateTimePicker aria-label="Bring back" onChange={onChange} value="" />);

    await user.click(trigger("Bring back"));
    await user.click(dayButton(chosenDate));

    expect(onChange).toHaveBeenCalledWith(`${chosenDate}T09:00`);
  });

  it("recombines an edited time with the held date", () => {
    const onChange = vi.fn();
    render(<DateTimePicker aria-label="Bring back" onChange={onChange} value="2026-07-15T14:30" />);

    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "16:00" } });

    expect(onChange).toHaveBeenLastCalledWith("2026-07-15T16:00");
  });

  it("clears the whole field when the time is emptied, as the native control does", () => {
    const onChange = vi.fn();
    render(<DateTimePicker aria-label="Bring back" onChange={onChange} value="2026-07-15T14:30" />);

    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "" } });

    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("snaps the default time up to the floor on the boundary day", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const boundaryDate = dayThisMonth(15);
    render(
      <DateTimePicker
        aria-label="Bring back"
        min={`${boundaryDate}T15:00`}
        onChange={onChange}
        value=""
      />,
    );

    await user.click(trigger("Bring back"));
    await user.click(dayButton(boundaryDate));

    expect(onChange).toHaveBeenLastCalledWith(`${boundaryDate}T15:00`);
  });

  it("bounds the time field on the boundary day only", () => {
    const onBoundary = render(
      <DateTimePicker aria-label="Bring back" min="2026-07-15T15:00" value="2026-07-15T16:00" />,
    );

    expect(screen.getByLabelText<HTMLInputElement>("Time").min).toBe("15:00");

    onBoundary.unmount();
    render(
      <DateTimePicker aria-label="Bring back" min="2026-07-15T15:00" value="2026-07-16T09:00" />,
    );

    expect(screen.getByLabelText<HTMLInputElement>("Time").min).toBe("");
  });

  it("leaves a later day unconstrained", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const boundaryDate = dayThisMonth(15);
    const laterDate = dayThisMonth(16);
    render(
      <DateTimePicker
        aria-label="Bring back"
        min={`${boundaryDate}T15:00`}
        onChange={onChange}
        value=""
      />,
    );

    await user.click(trigger("Bring back"));
    await user.click(dayButton(laterDate));

    expect(onChange).toHaveBeenLastCalledWith(`${laterDate}T09:00`);
  });

  /** Both halves size together, or the field reads as one tall control beside a short one. */
  it("carries the touch size into the time field as well as the trigger", () => {
    render(<DateTimePicker aria-label="Bring back" size="touch" timeLabel="Bring back time" />);

    expect(trigger("Bring back").className).toContain("h-11");
    expect(screen.getByLabelText("Bring back time").className).toContain("h-11");
  });

  it("posts the recombined value through one hidden input", () => {
    const { container } = render(
      <DateTimePicker defaultValue="2026-07-15T14:30" name="bringBackAt" />,
    );

    const hidden = container.querySelector<HTMLInputElement>('input[name="bringBackAt"]');

    expect(hidden?.value).toBe("2026-07-15T14:30");
  });
});

describe("value helpers", () => {
  it("serializes in local time, not UTC", () => {
    const date = new Date(2026, 6, 15, 14, 30);

    expect(toDateValue(date)).toBe("2026-07-15");
    expect(toDateTimeValue(date)).toBe("2026-07-15T14:30");
  });
});
