// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const { refresh, replace, push, signOut } = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace, push }) }));
vi.mock("@/app/actions/household-invitations", () => ({
  acceptHouseholdInvitationAction: vi.fn(),
  declineHouseholdInvitationAction: vi.fn(),
}));
vi.mock("@/lib/auth/client", () => ({ signOut }));
vi.mock("@/app/actions/reminders", () => ({
  disableCurrentReminderInstallationAction: vi.fn(),
}));

import { JoinInvitationSurface } from "./join-invitation-surface";

const SECRET = "a-very-long-opaque-secret";
const READY = {
  state: "ready" as const,
  householdName: "The Neely house",
  role: "member" as const,
  expiresAt: new Date("2026-08-15T09:00:00Z"),
  accessPending: false,
};
const READY_WHILE_PENDING = { ...READY, accessPending: true };

/**
 * The two presses joining always takes. Named rather than repeated so the tests
 * below read as what they are checking, not as the same pair of clicks five
 * times over.
 */
const openJoinConfirm = () =>
  userEvent.click(screen.getByRole("button", { name: "Join The Neely house" }));
const confirmJoin = () =>
  userEvent.click(screen.getByRole("button", { name: "Yes, join The Neely house" }));

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The states reached before the invited address is proven are the security
 * contract made visible: none of them may name a household, an inviter, or an
 * address, whatever the link's holder does.
 */
describe("what an unproven visitor is told", () => {
  it("gives a dead link one neutral ending and nothing to act on", () => {
    render(<JoinInvitationSurface secret={SECRET} view={{ state: "unusable" }} />);

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/can't be used/i);
    expect(text).toMatch(/used already, cancelled, or run out/i);
    expect(text).not.toMatch(/Neely/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks a signed-out visitor to sign in and comes back to the same link", () => {
    render(<JoinInvitationSurface secret={SECRET} view={{ state: "sign-in-required" }} />);

    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toBe(
      `/sign-in?returnTo=${encodeURIComponent(`/join/${SECRET}`)}`,
    );
    expect(screen.getByRole("link", { name: "Create an account" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Neely/);
  });

  it("tells a mismatched session which address to use without naming it", () => {
    render(<JoinInvitationSurface secret={SECRET} view={{ state: "address-mismatch" }} />);

    expect(screen.getByText(/signed in with a different email address/i)).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/Neely/);
  });

  /**
   * This state is only reachable with a live session — it is decided by
   * comparing the signed-in address against the invited one. So a link to
   * `/sign-in` is a door that cannot open: an authenticated visitor is
   * redirected straight back out of it, and the invitation is lost on the way.
   * Signing out is the only move that reaches the form, and it has to keep hold
   * of the link.
   */
  it("gets a mismatched session out of the session that is blocking it", async () => {
    render(<JoinInvitationSurface secret={SECRET} view={{ state: "address-mismatch" }} />);

    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
    });
    expect(push).toHaveBeenCalledWith(`/join/${SECRET}`);
  });

  it("explains an existing household privately and names neither one", () => {
    render(<JoinInvitationSurface secret={SECRET} view={{ state: "workspace-conflict" }} />);

    expect(screen.getByText(/one household at a time/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to your household" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Neely/);
  });
});

/**
 * Private Beta Access is the global denier for using Tendnote, not a rule about
 * who may belong to a household. An invited person who has not been admitted yet
 * joins for real and goes back to waiting for the site — so the page has to say
 * that before the press, at the press, and after it.
 */
describe("joining while Private Beta Access is still pending", () => {
  it("says what joining does and does not open, before anything is pressed", () => {
    render(<JoinInvitationSurface secret={SECRET} view={READY_WHILE_PENDING} />);

    expect(screen.getByText(/waiting for Private Beta Access/i).textContent).toMatch(
      /gives you your place in the household/i,
    );
    expect(screen.getByRole("button", { name: "Join The Neely house" })).toBeTruthy();
  });

  it("repeats it at the moment of commitment, and lands on the waiting page", async () => {
    const acceptAction = vi.fn().mockResolvedValue({ ok: true });
    render(
      <JoinInvitationSurface
        acceptAction={acceptAction}
        secret={SECRET}
        view={READY_WHILE_PENDING}
      />,
    );

    await openJoinConfirm();
    expect(screen.getByText(/You'll become a member of The Neely house/i).textContent).toMatch(
      /land back on the waiting page/i,
    );

    await confirmJoin();

    await waitFor(() => {
      expect(acceptAction).toHaveBeenCalledWith({ secret: SECRET });
    });
    expect(replace).toHaveBeenCalledWith("/pending");
    expect(screen.getByRole("status").textContent).toBe(
      "You've joined The Neely house. Tendnote opens when your access comes through.",
    );
  });
});

describe("joining", () => {
  /**
   * Joining is the most consequential control on the page: it creates a durable
   * membership and opens a shared layer. It must not be one mis-tap away, and
   * the sharing boundary belongs at the moment of commitment rather than only in
   * the paragraph above it.
   */
  it("restates what joining shares before it joins", async () => {
    const acceptAction = vi.fn().mockResolvedValue({ ok: true });
    render(<JoinInvitationSurface acceptAction={acceptAction} secret={SECRET} view={READY} />);

    expect(screen.getByText(/good until Aug 15/i)).toBeTruthy();

    await openJoinConfirm();
    expect(acceptAction).not.toHaveBeenCalled();
    const confirmation = screen.getByText(/You'll become a member of The Neely house/i);
    expect(confirmation.textContent).toMatch(/nothing you've already written moves/i);

    await userEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(screen.getByRole("button", { name: "Join The Neely house" })).toBeTruthy();

    await openJoinConfirm();
    await confirmJoin();

    await waitFor(() => {
      expect(acceptAction).toHaveBeenCalledWith({ secret: SECRET });
    });
    expect(replace).toHaveBeenCalledWith("/account/household");
  });

  /** The outcome replaces the control that had focus, so it has to be spoken. */
  it("announces the outcome into a region that was already there", async () => {
    const acceptAction = vi.fn().mockResolvedValue({ ok: true });
    render(<JoinInvitationSurface acceptAction={acceptAction} secret={SECRET} view={READY} />);

    expect(screen.getByRole("status").textContent).toBe("");

    await openJoinConfirm();
    await confirmJoin();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("You've joined The Neely house.");
    });
  });

  it("offers a retry for a failure that might actually pass next time", async () => {
    const acceptAction = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Something broke.", terminal: false });
    render(<JoinInvitationSurface acceptAction={acceptAction} secret={SECRET} view={READY} />);

    await openJoinConfirm();
    await confirmJoin();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Something broke.");
    });
    // Still actionable: the visitor can press it again.
    expect(screen.getByRole("button", { name: "Yes, join The Neely house" })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  /**
   * An invitation cancelled while this page was open is over. Leaving a Join
   * button in front of someone means offering a retry that can never succeed.
   */
  it("ends the page on a terminal refusal instead of inviting a doomed retry", async () => {
    const refusal =
      "This invitation link can't be used. Ask whoever invited you to send a new one.";
    const acceptAction = vi.fn().mockResolvedValue({ ok: false, error: refusal, terminal: true });
    render(<JoinInvitationSurface acceptAction={acceptAction} secret={SECRET} view={READY} />);

    await openJoinConfirm();
    await confirmJoin();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(refusal);
    });
    // Once in the panel, once in the live region — and no control left to press.
    expect(screen.getAllByText(refusal)).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  /** Declining is permanent, so it must not be one press away from a mis-tap either. */
  it("says what declining ends before it ends it", async () => {
    const declineAction = vi.fn().mockResolvedValue({ ok: true });
    render(<JoinInvitationSurface declineAction={declineAction} secret={SECRET} view={READY} />);

    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(declineAction).not.toHaveBeenCalled();
    expect(screen.getByText(/the link stops working/i)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Keep it for now" }));
    expect(screen.getByRole("button", { name: "Join The Neely house" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, decline" }));

    await waitFor(() => {
      expect(screen.getByText(/no longer works/i)).toBeTruthy();
    });
    expect(declineAction).toHaveBeenCalledWith({ secret: SECRET });
    expect(screen.queryByRole("button", { name: /Join/ })).toBeNull();
  });
});
