// @vitest-environment jsdom
import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor, within } from "@/test/dom";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/households", () => ({ createHouseholdAction: vi.fn() }));

import { HouseholdSurface } from "./household-surface";

const OVERVIEW: HouseholdOverview = {
  householdId: "household-1",
  name: "The Neely house",
  viewerRole: "owner",
  isSoleMember: true,
  seats: { limit: 8, occupied: 1, remaining: 7, isFull: false },
  members: [
    {
      userId: "owner-1",
      name: "Alex",
      email: "alex@example.com",
      role: "owner",
      isViewer: true,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("household activation", () => {
  it("creates the named household and lands on its overview without leaving the page", async () => {
    const createHouseholdAction = vi.fn().mockResolvedValue({ ok: true, view: OVERVIEW });
    render(
      <HouseholdSurface createHouseholdAction={createHouseholdAction} initialOverview={null} />,
    );

    await userEvent.type(screen.getByLabelText("Household name"), "  The Neely house  ");
    await userEvent.click(screen.getByRole("button", { name: "Create household" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "The Neely house" })).toBeTruthy();
    });
    expect(createHouseholdAction).toHaveBeenCalledWith({ name: "The Neely house" });
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Create household" })).toBeNull();
  });

  /**
   * The swap destroys the control that had focus. Without a landing place focus
   * falls to the document body, so a screen-reader user gets no confirmation at
   * the exact moment the task completes.
   */
  it("confirms completion to assistive technology and gives focus somewhere to land", async () => {
    const createHouseholdAction = vi.fn().mockResolvedValue({ ok: true, view: OVERVIEW });
    render(
      <HouseholdSurface createHouseholdAction={createHouseholdAction} initialOverview={null} />,
    );

    // The live region is mounted and empty before the swap, so its later text is
    // a content change into an existing region rather than a new region.
    expect(screen.getByRole("status").textContent).toBe("");

    await userEvent.type(screen.getByLabelText("Household name"), "The Neely house");
    await userEvent.click(screen.getByRole("button", { name: "Create household" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "The Neely house is ready. You're its owner.",
      );
    });
    const heading = screen.getByRole("heading", { name: "The Neely house" });
    expect(document.activeElement).toBe(heading);
    // A landing place, not a control: it stays out of the tab order.
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("says plainly that a household cannot be renamed or removed here", () => {
    render(<HouseholdSurface initialOverview={null} />);

    const durability = screen.getByText(/nothing here renames or removes one/i);
    expect(durability).toBeTruthy();
    expect(screen.getByLabelText("Household name").getAttribute("aria-describedby")).toContain(
      durability.id,
    );
  });

  it("will not submit an unnamed household", async () => {
    const createHouseholdAction = vi.fn();
    render(
      <HouseholdSurface createHouseholdAction={createHouseholdAction} initialOverview={null} />,
    );

    const submit = screen.getByRole("button", { name: "Create household" });
    expect(submit.hasAttribute("disabled")).toBe(true);

    await userEvent.type(screen.getByLabelText("Household name"), "   ");
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(createHouseholdAction).not.toHaveBeenCalled();
  });

  /**
   * The one-active-workspace conflict is explained in place. A stale client that
   * still submits must not navigate, switch context, or learn anything about the
   * household the caller is already in.
   */
  it("explains an admission conflict in place without switching context", async () => {
    const conflict =
      "You're already in a household. Tendnote keeps you in one household at a time, so nothing here has changed.";
    const createHouseholdAction = vi.fn().mockResolvedValue({ ok: false, error: conflict });
    render(
      <HouseholdSurface createHouseholdAction={createHouseholdAction} initialOverview={null} />,
    );

    await userEvent.type(screen.getByLabelText("Household name"), "Second home");
    await userEvent.click(screen.getByRole("button", { name: "Create household" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(conflict);
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Start a household" })).toBeTruthy();
    expect(screen.getByLabelText("Household name").getAttribute("aria-invalid")).toBe("true");
  });

  it("recovers from a failed creation without losing what the user typed", async () => {
    const createHouseholdAction = vi.fn().mockRejectedValue(new Error("network"));
    render(
      <HouseholdSurface createHouseholdAction={createHouseholdAction} initialOverview={null} />,
    );

    await userEvent.type(screen.getByLabelText("Household name"), "The Neely house");
    await userEvent.click(screen.getByRole("button", { name: "Create household" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Nothing changed");
    });
    expect((screen.getByLabelText("Household name") as HTMLInputElement).value).toBe(
      "The Neely house",
    );
  });
});

describe("household overview", () => {
  it("shows an active member their household, their role, and its occupied places", () => {
    render(<HouseholdSurface initialOverview={OVERVIEW} />);

    expect(screen.getByRole("heading", { name: "The Neely house" })).toBeTruthy();
    expect(screen.getByText("1 of 8 places taken")).toBeTruthy();
    // Orientation: what having a household actually changes for the reader.
    expect(screen.getByText(/household visibility so everyone here can read it/i)).toBeTruthy();

    const person = within(screen.getByRole("listitem"));
    expect(person.getByText("Alex")).toBeTruthy();
    expect(person.getByText("You")).toBeTruthy();
    // Role reads as text, not as a color-only cue.
    expect(person.getByText("Owner")).toBeTruthy();
    expect(person.getByText("alex@example.com")).toBeTruthy();
  });

  it("offers an active member no way to start a second household", () => {
    render(<HouseholdSurface initialOverview={OVERVIEW} />);

    expect(screen.queryByRole("button", { name: "Create household" })).toBeNull();
    expect(screen.queryByLabelText("Household name")).toBeNull();
  });

  it("renders no invitation or external-send affordance", () => {
    render(
      <HouseholdSurface
        initialOverview={{
          ...OVERVIEW,
          isSoleMember: false,
          seats: { limit: 8, occupied: 2, remaining: 6, isFull: false },
          members: [
            ...OVERVIEW.members,
            {
              userId: "member-1",
              name: "Sam",
              email: "sam@example.com",
              role: "member",
              isViewer: false,
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
    for (const label of [/invite/i, /send/i, /email/i]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });
});
