// @vitest-environment jsdom
import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor, within } from "@/test/dom";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/households", () => ({ createHouseholdAction: vi.fn() }));
// The panels import their server actions as defaults; every test here injects
// its own, so the real (server-only) module must never be pulled in.
vi.mock("@/app/actions/household-invitations", () => ({
  sendHouseholdInvitationAction: vi.fn(),
  resendHouseholdInvitationAction: vi.fn(),
  cancelHouseholdInvitationAction: vi.fn(),
}));
vi.mock("@/app/actions/household-governance", () => ({
  offerHouseholdOwnerRoleAction: vi.fn(),
  withdrawHouseholdOwnerOfferAction: vi.fn(),
  acceptHouseholdOwnerRoleAction: vi.fn(),
  declineHouseholdOwnerRoleAction: vi.fn(),
  stepDownFromHouseholdOwnerAction: vi.fn(),
  removeHouseholdMemberAction: vi.fn(),
  leaveHouseholdAction: vi.fn(),
  confirmHouseholdDissolutionAction: vi.fn(),
  cancelHouseholdDissolutionAction: vi.fn(),
}));

import { HouseholdSurface } from "./household-surface";
import { governanceDefaults, member } from "./household-test-overview";

const OVERVIEW: HouseholdOverview = {
  householdId: "household-1",
  name: "The Neely house",
  viewerRole: "owner",
  isSoleMember: true,
  invitations: [],
  seats: { limit: 8, occupied: 1, remaining: 7, isFull: false },
  members: [member({ userId: "owner-1", name: "Alex", email: "alex@example.com", role: "owner" })],
  ...governanceDefaults({ viewerRole: "owner", soleMember: true }),
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

  /**
   * Activation is where someone commits, so this line has to keep matching what
   * the product can actually do. It used to promise a one-way door; leaving and
   * ending exist now, and renaming still does not.
   */
  it("names both the exits that exist and the rename that does not", () => {
    render(<HouseholdSurface initialOverview={null} />);

    const durability = screen.getByText(/nothing renames a household/i);
    expect(durability.textContent).toMatch(/you can leave later/i);
    expect(durability.textContent).toMatch(/owners can end it together/i);
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

  it("counts a live invitation as an occupied place", () => {
    render(
      <HouseholdSurface
        initialOverview={{
          ...OVERVIEW,
          invitations: [PENDING_INVITATION],
          seats: { limit: 8, occupied: 2, remaining: 6, isFull: false },
        }}
      />,
    );

    expect(screen.getByText("2 of 8 places taken")).toBeTruthy();
  });
});

const PENDING_INVITATION = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "sam@example.com",
  state: "pending" as const,
  expiresAt: new Date("2026-08-15T09:00:00Z"),
  canResend: true,
  canCancel: true,
};

const MEMBER_OVERVIEW: HouseholdOverview = {
  ...OVERVIEW,
  viewerRole: "member",
  isSoleMember: false,
  invitations: [],
  seats: { limit: 8, occupied: 3, remaining: 5, isFull: false },
  members: [
    member({ userId: "member-1", name: "Sam", email: "sam@example.com" }),
    member({
      userId: "owner-1",
      name: "Alex",
      email: "alex@example.com",
      role: "owner",
      isViewer: false,
    }),
  ],
  ...governanceDefaults({ viewerRole: "member" }),
};

describe("household invitations", () => {
  it("tells an owner what sending actually does before they press it", () => {
    render(<HouseholdSurface initialOverview={OVERVIEW} />);

    const hint = screen.getByText(/Sending emails them a private link/i);
    expect(hint.textContent).toMatch(/only someone signed in with this exact address/i);
    expect(hint.textContent).toMatch(/14 days/);
    expect(hint.textContent).toMatch(/holds a place/i);
    expect(screen.getByLabelText("Email address").getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("sends the invitation and shows the new place it is holding", async () => {
    const sent: HouseholdOverview = {
      ...OVERVIEW,
      invitations: [PENDING_INVITATION],
      seats: { limit: 8, occupied: 2, remaining: 6, isFull: false },
    };
    const send = vi.fn().mockResolvedValue({ ok: true, view: sent });
    render(<HouseholdSurface initialOverview={OVERVIEW} invitationActions={{ send }} />);

    await userEvent.type(screen.getByLabelText("Email address"), "  sam@example.com  ");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(screen.getByText("2 of 8 places taken")).toBeTruthy();
    });
    expect(send).toHaveBeenCalledWith({ email: "sam@example.com" });
    expect(screen.getByText("sam@example.com")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Invitation sent to sam@example.com.");
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("");
    expect(refresh).toHaveBeenCalled();
  });

  it("explains a refused send in place without clearing what was typed", async () => {
    const refusal = "There's already a live invitation to that address. Resend or cancel it first.";
    const send = vi.fn().mockResolvedValue({ ok: false, error: refusal });
    render(<HouseholdSurface initialOverview={OVERVIEW} invitationActions={{ send }} />);

    await userEvent.type(screen.getByLabelText("Email address"), "sam@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(refusal);
    });
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe(
      "sam@example.com",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cancels an invitation and gives the place back", async () => {
    const cancel = vi.fn().mockResolvedValue({ ok: true, view: OVERVIEW });
    render(
      <HouseholdSurface
        initialOverview={{
          ...OVERVIEW,
          invitations: [PENDING_INVITATION],
          seats: { limit: 8, occupied: 2, remaining: 6, isFull: false },
        }}
        invitationActions={{ cancel }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.getByText("1 of 8 places taken")).toBeTruthy();
    });
    expect(cancel).toHaveBeenCalledWith({ invitationId: PENDING_INVITATION.id });
    expect(screen.queryByText("sam@example.com")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Invitation to sam@example.com cancelled.");
  });

  /** A disabled control with no reason reads as a bug, not as a cooldown. */
  it("says why resend is unavailable rather than only disabling it", () => {
    render(
      <HouseholdSurface
        initialOverview={{
          ...OVERVIEW,
          invitations: [{ ...PENDING_INVITATION, canResend: false }],
          seats: { limit: 8, occupied: 2, remaining: 6, isFull: false },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Resend" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/send it again in a couple of minutes/i)).toBeTruthy();
  });

  it("replaces the form with an explanation when every place is taken", () => {
    render(
      <HouseholdSurface
        initialOverview={{
          ...OVERVIEW,
          invitations: [PENDING_INVITATION],
          seats: { limit: 8, occupied: 8, remaining: 0, isFull: true },
        }}
      />,
    );

    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(screen.getByText(/Every place in this household is taken/i)).toBeTruthy();
    // Cancelling is still the way out, so it stays available.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  /**
   * A row that simply disappears leaves the Owner unable to tell a decline from
   * a link nobody opened — which is the one question they have.
   */
  it("says how an invitation ended instead of letting the row vanish", () => {
    render(
      <HouseholdSurface
        initialOverview={{
          ...OVERVIEW,
          invitations: [
            { ...PENDING_INVITATION, state: "declined", canResend: false, canCancel: false },
            {
              ...PENDING_INVITATION,
              id: "22222222-2222-4222-8222-222222222222",
              email: "jules@example.com",
              state: "expired",
              canResend: false,
              canCancel: false,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Declined")).toBeTruthy();
    expect(screen.getByText("Ran out")).toBeTruthy();
    // An ended invitation holds no seat and offers nothing to press.
    expect(screen.getByText("1 of 8 places taken")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  /** Sending is an Owner capability, so the addresses an Owner typed are not household-wide. */
  it("shows a member the occupied places but no invitation state or controls", () => {
    render(<HouseholdSurface initialOverview={MEMBER_OVERVIEW} />);

    expect(screen.getByText("3 of 8 places taken")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Invitations" })).toBeNull();
    expect(screen.queryByLabelText("Email address")).toBeNull();
    // The one control a member does hold is their own way out - never anything
    // pointed at another person, and nothing about ending the household.
    expect(screen.queryAllByRole("button").map((button) => button.textContent)).toEqual([
      "Leave household",
    ]);
  });
});
