// @vitest-environment jsdom
import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor, within } from "@/test/dom";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/households", () => ({ createHouseholdAction: vi.fn() }));
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

const OPEN = { available: true, blockedReason: null };

const PROTECTED_CO_OWNER =
  "Owners can't remove another owner. They can step down or leave whenever they choose.";

function overview(overrides: Partial<HouseholdOverview> = {}): HouseholdOverview {
  return {
    householdId: "household-1",
    name: "The Neely house",
    viewerRole: "owner",
    isSoleMember: false,
    invitations: [],
    seats: { limit: 8, occupied: 2, remaining: 6, isFull: false },
    members: [
      member({ userId: "ana", name: "Ana", email: "ana@example.com", role: "owner" }),
      member({
        userId: "ben",
        name: "Ben",
        email: "ben@example.com",
        isViewer: false,
        promote: OPEN,
        remove: OPEN,
      }),
    ],
    ...governanceDefaults({ viewerRole: "owner" }),
    ...overrides,
  };
}

function rowFor(name: string) {
  const row = screen.getByText(name).closest("li");
  if (!row) throw new Error(`No member row for ${name}`);
  return within(row);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("promotion to co-owner", () => {
  it("offers the role rather than granting it, and says whose answer it is", async () => {
    const offered = overview({
      members: [
        member({ userId: "ana", name: "Ana", email: "ana@example.com", role: "owner" }),
        member({
          userId: "ben",
          name: "Ben",
          email: "ben@example.com",
          isViewer: false,
          awaitingOwnerReply: true,
          promote: {
            available: false,
            blockedReason:
              "They've already been asked. It's theirs to accept whenever they're ready.",
          },
          remove: OPEN,
        }),
      ],
    });
    const offer = vi.fn().mockResolvedValue({ ok: true, view: offered });
    render(<HouseholdSurface initialOverview={overview()} memberActions={{ offer }} />);

    await userEvent.click(rowFor("Ben").getByRole("button", { name: "Make an owner" }));

    await waitFor(() => {
      expect(rowFor("Ben").getByText(/Asked to co-own/i)).toBeTruthy();
    });
    expect(offer).toHaveBeenCalledWith({ memberUserId: "ben" });
    // Still a member. Nothing about the offer reads as authority.
    expect(rowFor("Ben").getByText("Member")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Ben was asked to co-own");
  });

  it("lets the household take an unanswered offer back", async () => {
    const asked = overview({
      members: [
        member({ userId: "ana", name: "Ana", email: "ana@example.com", role: "owner" }),
        member({
          userId: "ben",
          name: "Ben",
          email: "ben@example.com",
          isViewer: false,
          awaitingOwnerReply: true,
          remove: OPEN,
        }),
      ],
    });
    const withdraw = vi.fn().mockResolvedValue({ ok: true, view: overview() });
    render(<HouseholdSurface initialOverview={asked} memberActions={{ withdraw }} />);

    await userEvent.click(rowFor("Ben").getByRole("button", { name: "Take it back" }));

    await waitFor(() => {
      expect(rowFor("Ben").getByRole("button", { name: "Make an owner" })).toBeTruthy();
    });
    expect(withdraw).toHaveBeenCalledWith({ memberUserId: "ben" });
  });

  it("asks the recipient plainly, and says what co-owning does not open", async () => {
    const asMember = overview({
      viewerRole: "member",
      ...governanceDefaults({ viewerRole: "member" }),
      members: [
        member({ userId: "ben", name: "Ben", email: "ben@example.com", awaitingOwnerReply: true }),
        member({
          userId: "ana",
          name: "Ana",
          email: "ana@example.com",
          role: "owner",
          isViewer: false,
        }),
      ],
      ownerOffer: { offeredByName: "Ana" },
    });
    const accepted = overview({ viewerRole: "owner", ownerOffer: null });
    const acceptOffer = vi.fn().mockResolvedValue({ ok: true, view: accepted });
    render(<HouseholdSurface governanceActions={{ acceptOffer }} initialOverview={asMember} />);

    const offer = screen.getByRole("heading", {
      name: /Ana asked you to co-own The Neely house/i,
    }).parentElement?.parentElement;
    expect(offer?.textContent).toMatch(/no owner can remove another/i);
    expect(offer?.textContent).toMatch(/open anyone.s private notes/i);
    expect(offer?.textContent).toMatch(/you can say no/i);

    await userEvent.click(screen.getByRole("button", { name: "Become an owner" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Become an owner" })).toBeNull();
    });
    expect(acceptOffer).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("You're now an owner");
  });

  it("keeps declining a no-consequence answer", async () => {
    const asMember = overview({
      viewerRole: "member",
      ...governanceDefaults({ viewerRole: "member" }),
      members: [member({ userId: "ben", name: "Ben", email: "ben@example.com" })],
      ownerOffer: { offeredByName: "Ana" },
    });
    const declineOffer = vi
      .fn()
      .mockResolvedValue({ ok: true, view: { ...asMember, ownerOffer: null } });
    render(<HouseholdSurface governanceActions={{ declineOffer }} initialOverview={asMember} />);

    await userEvent.click(screen.getByRole("button", { name: "Not now" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("You stayed a member. Nothing changed.");
    });
  });
});

describe("protected owners", () => {
  it("explains the protection on a co-owner's row instead of offering a dead control", () => {
    render(
      <HouseholdSurface
        initialOverview={overview({
          members: [
            member({ userId: "ana", name: "Ana", email: "ana@example.com", role: "owner" }),
            member({
              userId: "ben",
              name: "Ben",
              email: "ben@example.com",
              role: "owner",
              isViewer: false,
              promote: { available: false, blockedReason: "They're already an owner here." },
              remove: { available: false, blockedReason: PROTECTED_CO_OWNER },
            }),
          ],
        })}
      />,
    );

    const row = rowFor("Ben");
    expect(row.getByText(PROTECTED_CO_OWNER)).toBeTruthy();
    expect(row.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(row.queryByRole("button", { name: "Make an owner" })).toBeNull();
  });

  it("holds the last owner back from leaving and names what would unblock it", () => {
    render(<HouseholdSurface initialOverview={overview()} />);

    expect(screen.queryByRole("button", { name: "Leave household" })).toBeNull();
    expect(
      screen.getByText(/You're the only owner\. Ask someone here to become an owner too/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Step down" })).toBeNull();
  });

  it("opens both exits again once a second owner exists", () => {
    render(<HouseholdSurface initialOverview={overview({ departure: OPEN, stepDown: OPEN })} />);

    expect(screen.getByRole("button", { name: "Leave household" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Step down" })).toBeTruthy();
  });
});

describe("removal and departure", () => {
  it("asks before ending someone else's access and says exactly what ends", async () => {
    const remove = vi.fn().mockResolvedValue({
      ok: true,
      view: overview({
        members: [member({ userId: "ana", name: "Ana", email: "ana@example.com", role: "owner" })],
        seats: { limit: 8, occupied: 1, remaining: 7, isFull: false },
      }),
    });
    render(<HouseholdSurface initialOverview={overview()} memberActions={{ remove }} />);

    await userEvent.click(rowFor("Ben").getByRole("button", { name: "Remove" }));

    const dialog = within(screen.getByRole("alertdialog"));
    expect(dialog.getByText(/Their access ends right away/i).textContent).toMatch(
      /what they wrote stays theirs/i,
    );
    // A refusal to press is offered in the household's own words, not "Cancel".
    expect(dialog.getByRole("button", { name: "Keep them here" })).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();

    await userEvent.click(dialog.getByRole("button", { name: "Remove them" }));

    await waitFor(() => {
      expect(screen.getByText("1 of 8 places taken")).toBeTruthy();
    });
    expect(remove).toHaveBeenCalledWith({ memberUserId: "ben" });
  });

  /**
   * A departure must be *seen* to have happened. Swapping straight to a blank
   * activation form leaves the only confirmation in a live region, which is
   * nothing at all for a sighted reader, and it drops keyboard focus to the body
   * as the dialog that triggered it unmounts.
   */
  it("rests on what happened before offering the way back in", async () => {
    const leave = vi.fn().mockResolvedValue({ ok: true, view: { view: null } });
    render(
      <HouseholdSurface
        governanceActions={{ leave }}
        initialOverview={overview({ departure: OPEN })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Leave household" }));
    const dialog = within(screen.getByRole("alertdialog"));
    expect(dialog.getByText(/Coming back would need a fresh invitation/i)).toBeTruthy();
    await userEvent.click(dialog.getByRole("button", { name: "Leave household" }));

    const heading = await waitFor(() =>
      screen.getByRole("heading", { name: "You've left The Neely house" }),
    );
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByRole("heading", { name: "Start a household" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("You've left The Neely house.");

    await userEvent.click(screen.getByRole("button", { name: "Start a household" }));

    const activation = screen.getByRole("heading", { name: "Start a household" });
    expect(activation).toBeTruthy();
    expect(document.activeElement).toBe(activation);
  });
});

describe("ending the household", () => {
  const twoOwners = (dissolution: Partial<HouseholdOverview["dissolution"]> = {}) =>
    overview({
      departure: OPEN,
      stepDown: OPEN,
      dissolution: {
        available: true,
        blockedReason: null,
        required: 2,
        confirmed: 0,
        awaitingUserIds: ["ana", "ben"],
        unanimous: false,
        viewerHasConfirmed: false,
        ...dissolution,
      },
    });

  /**
   * With another owner still to agree, this press commits nothing irreversible,
   * so it must not be dressed as though it does — and it must say who it waits on.
   */
  it("treats an agreement that ends nothing yet as an ordinary commitment", async () => {
    const confirmDissolution = vi.fn().mockResolvedValue({
      ok: true,
      view: {
        dissolution: { required: 2, confirmed: 1, awaitingUserIds: ["ben"], unanimous: false },
        view: twoOwners({ confirmed: 1, awaitingUserIds: ["ben"], viewerHasConfirmed: true }),
      },
    });
    render(
      <HouseholdSurface governanceActions={{ confirmDissolution }} initialOverview={twoOwners()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Agree to end it" }));
    const dialog = within(screen.getByRole("alertdialog"));
    expect(dialog.getByText(/Nothing changes yet/i).textContent).toMatch(
      /one other owner would still need to agree/i,
    );
    // No phrase gate: the friction matches the loss, and nothing is lost here.
    expect(dialog.queryByText(/to confirm/i)).toBeNull();
    // Nor the destructive weight, which belongs to the press that ends something.
    expect(dialog.getByRole("button", { name: "Agree to end it" }).dataset.variant).not.toBe(
      "destructive",
    );

    await userEvent.click(dialog.getByRole("button", { name: "Agree to end it" }));

    await waitFor(() => {
      expect(screen.getByText(/You've agreed to end The Neely house/i)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Change my mind" })).toBeTruthy();
  });

  it("lets an owner withdraw their agreement", async () => {
    const cancelDissolution = vi
      .fn()
      .mockResolvedValue({ ok: true, view: { dissolution: {}, view: twoOwners() } });
    render(
      <HouseholdSurface
        governanceActions={{ cancelDissolution }}
        initialOverview={twoOwners({
          confirmed: 1,
          awaitingUserIds: ["ben"],
          viewerHasConfirmed: true,
        })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Change my mind" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Agree to end it" })).toBeTruthy();
    });
    expect(cancelDissolution).toHaveBeenCalled();
  });

  /**
   * The press that actually ends it carries the full weight: the recovery window,
   * the fact that getting it back is not something anyone can do from in here,
   * and a retyped phrase so it cannot happen on a reflex.
   */
  it("gates the final press behind a retyped phrase and states the recovery boundary", async () => {
    const confirmDissolution = vi.fn().mockResolvedValue({
      ok: true,
      view: { dissolution: { unanimous: true }, view: null },
    });
    render(
      <HouseholdSurface
        governanceActions={{ confirmDissolution }}
        initialOverview={twoOwners({ confirmed: 1, awaitingUserIds: ["ana"] })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "End this household" }));
    const dialog = within(screen.getByRole("alertdialog"));
    // Nothing sweeps a dissolved household's records, so the copy promises what
    // the product actually does — support can put it back — and never deletion.
    const consequence = dialog.getByText(/Everyone's access ends the moment you press this/i);
    expect(consequence.textContent).toMatch(/for 30 days afterwards support can still put/i);
    expect(consequence.textContent).not.toMatch(/delet/i);
    const boundary = dialog.getByText(/handled by support/i);
    expect(boundary.textContent).toMatch(/no way for anyone else here to take it over/i);
    // A boundary that names support has to say how to reach them.
    expect(
      within(boundary).getByRole("link", { name: "support@tendnote.com" }).getAttribute("href"),
    ).toBe("mailto:support@tendnote.com");

    const endIt = dialog.getByRole("button", { name: "End it" });
    expect(endIt.dataset.variant).toBe("destructive");
    expect(endIt.hasAttribute("disabled")).toBe(true);
    await userEvent.click(endIt);
    expect(confirmDissolution).not.toHaveBeenCalled();

    const phrase = dialog.getByRole("code" as never) ?? null;
    const phraseText = (phrase as HTMLElement | null)?.textContent ?? "";
    await userEvent.type(dialog.getByLabelText(/to confirm/i), phraseText);
    await userEvent.click(dialog.getByRole("button", { name: "End it" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "The Neely house has ended" })).toBeTruthy();
    });
    expect(confirmDissolution).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("The Neely house has ended.");
  });

  /**
   * The one press whose label can be wrong. `endsNow` is read off an Overview
   * that may be a moment old, so a reader can press "Agree to end it" and have
   * it be the confirmation that ends the household. What they are told has to
   * come from the answer, not from the button they pressed.
   */
  it("tells the reader the household ended even when the press said only 'agree'", async () => {
    const confirmDissolution = vi.fn().mockResolvedValue({
      ok: true,
      view: { dissolution: { unanimous: true }, view: null },
    });
    render(
      <HouseholdSurface
        governanceActions={{ confirmDissolution }}
        // Three owners on this screen, so this reader believes two more have to
        // agree after them. Both of them already did.
        initialOverview={twoOwners({ required: 3, confirmed: 0, awaitingUserIds: ["ana"] })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Agree to end it" }));
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Agree to end it" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "The Neely house has ended" })).toBeTruthy();
    });
    expect(screen.getByRole("status").textContent).toBe("The Neely house has ended.");
  });

  it("gives the reader who ended it the way to reach support", async () => {
    const confirmDissolution = vi.fn().mockResolvedValue({
      ok: true,
      view: { dissolution: { unanimous: true }, view: null },
    });
    render(
      <HouseholdSurface
        governanceActions={{ confirmDissolution }}
        initialOverview={twoOwners({ required: 3, confirmed: 0, awaitingUserIds: ["ana"] })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Agree to end it" }));
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Agree to end it" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/support can still put the household back/i)).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "support@tendnote.com" }).getAttribute("href")).toBe(
      "mailto:support@tendnote.com",
    );
  });

  it("shows a member the boundary rather than the button", () => {
    render(
      <HouseholdSurface
        initialOverview={overview({
          viewerRole: "member",
          ...governanceDefaults({ viewerRole: "member" }),
          members: [member({ userId: "ben", name: "Ben", email: "ben@example.com" })],
          dissolution: {
            available: false,
            blockedReason: "Only an owner can end a household.",
            required: 1,
            confirmed: 0,
            awaitingUserIds: ["ana"],
            unanimous: false,
            viewerHasConfirmed: false,
          },
        })}
      />,
    );

    expect(screen.getByText("Only an owner can end a household.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /end (it|this household)/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Agree to end it" })).toBeNull();
  });
});
