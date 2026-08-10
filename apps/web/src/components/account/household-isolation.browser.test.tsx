import type { HouseholdOverview } from "@tendnote/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { renderInBrowser } from "@/test/browser";
import { HouseholdSurface } from "./household-surface";

/**
 * What a former member's household page actually renders, in a real browser.
 *
 * The isolation matrix proves the server answers `null` for someone whose
 * membership has ended. This is the other half of the same claim, and the half a
 * unit test cannot make: that the page built from that answer discloses nothing.
 * Fail-closed at the boundary is worth very little if the surface above it keeps
 * a name in a heading, a member count in a subtitle, or a control that would
 * reopen what has ended.
 *
 * Deliberately driven from the two states a departed member can be rendered in -
 * no household at all, and the resting screen shown right after an ending -
 * rather than through a login flow. Those are the only two the server can
 * produce for them, and reaching them directly is what keeps this spec about the
 * disclosure question instead of about session plumbing.
 */
const ENDED_HOUSEHOLD_NAME = "Ash Lane";
/** Things a household held that must not survive on a former member's screen. */
const HOUSEHOLD_CONTENT = [
  "Mara",
  "Put the bins out",
  "Boiler service is due",
  "Kitchen refrigerator",
];

let unmount: (() => Promise<void>) | undefined;

afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

describe("a former member's household surface fails closed in the browser", () => {
  it("renders no household content and no way back in when the server answers nothing", async () => {
    await page.viewport(390, 844);
    const rendered = await renderInBrowser(<HouseholdSurface initialOverview={null} />);
    unmount = rendered.unmount;

    // The one thing a person with no household may do is start one. Everything
    // that would describe a household they used to be in is absent, not
    // disabled: a disabled control still says the household exists.
    await expect.element(page.getByRole("button", { name: /create household/i })).toBeVisible();
    for (const name of [ENDED_HOUSEHOLD_NAME, ...HOUSEHOLD_CONTENT]) {
      expect(page.getByText(name).query(), `${name} must not be rendered`).toBeNull();
    }
    for (const control of [/invite/i, /remove/i, /end this household/i, /leave/i, /recover/i]) {
      expect(page.getByRole("button", { name: control }).query()).toBeNull();
    }
  });

  it("says what happened and what happens next, without offering a way to undo it", async () => {
    await page.viewport(390, 844);
    // The resting screen immediately after a dissolution: the one place the
    // ended household is still named, because the person reading it is the one
    // who just ended it. It is a receipt, not a door.
    const rendered = await renderInBrowser(
      <HouseholdSurface
        governanceActions={{
          confirmDissolution: vi.fn().mockResolvedValue({
            ok: true,
            view: { dissolution: { unanimous: true }, view: null },
          }),
        }}
        initialOverview={endedByDissolution()}
      />,
    );
    unmount = rendered.unmount;

    await page.getByRole("button", { name: "End this household" }).click();
    // The retyped phrase is read off the dialog rather than assumed: what the
    // press is gated on is the copy the reader is actually shown.
    const phrase = (await page.getByRole("code").element()).textContent ?? "";
    await page.getByLabelText(/to confirm/i).fill(phrase);
    await page.getByRole("button", { name: "End it" }).click();

    await expect
      .element(page.getByRole("heading", { name: `${ENDED_HOUSEHOLD_NAME} has ended` }))
      .toBeVisible();
    // Both halves of the window, in the browser: support can restore it for
    // thirty days, and after that what the household held is deleted (#391).
    await expect.element(page.getByText(/support can still put the household back/i)).toBeVisible();
    await expect
      .element(page.getByText(/what the household itself held is deleted/i))
      .toBeVisible();
    // No self-service recovery. Support-only means there is no product path,
    // and a control here would be the whole boundary undone.
    for (const control of [/recover/i, /restore/i, /undo/i, /reopen/i]) {
      expect(page.getByRole("button", { name: control }).query()).toBeNull();
    }
    // Nothing the household held survives onto the receipt.
    for (const name of HOUSEHOLD_CONTENT) {
      expect(page.getByText(name).query(), `${name} must not be rendered`).toBeNull();
    }
  });

  it("offers no external send or provider write from a household surface", async () => {
    await page.viewport(390, 844);
    const rendered = await renderInBrowser(<HouseholdSurface initialOverview={null} />);
    unmount = rendered.unmount;

    await expect.element(page.getByRole("button", { name: /create household/i })).toBeVisible();
    // Household authorization is never approval to send, and Tendnote never
    // writes to a provider. Neither capability may be reachable from a surface
    // rendered for someone with no household - and the transport behind
    // invitations refuses in production regardless, which is the same boundary
    // asserted from the other side in `lib/household/invitation-delivery.test.ts`.
    for (const forbidden of [/send/i, /email/i, /invite/i, /sync/i, /add to calendar/i]) {
      expect(page.getByRole("button", { name: forbidden }).query()).toBeNull();
    }
    expect(page.getByRole("link", { name: /mailto:/i }).query()).toBeNull();
  });
});

/** An Overview for a sole Owner whose one press ends the household. */
function endedByDissolution(): HouseholdOverview {
  return {
    householdId: "00000000-0000-4000-8000-000000000001",
    name: ENDED_HOUSEHOLD_NAME,
    viewerRole: "owner",
    isSoleMember: true,
    invitations: [],
    seats: { limit: 8, occupied: 1, remaining: 7, isFull: false },
    members: [
      {
        userId: "ana",
        name: "Ana",
        email: "ana@example.test",
        role: "owner",
        isViewer: true,
        remove: { available: false, blockedReason: null },
        promote: { available: false, blockedReason: null },
        awaitingOwnerReply: false,
      },
    ],
    ownerOffer: null,
    departure: { available: false, blockedReason: "You're the only owner." },
    stepDown: { available: false, blockedReason: null },
    invitation: { available: true, blockedReason: null },
    dissolution: {
      available: true,
      blockedReason: null,
      required: 1,
      confirmed: 0,
      unanimous: false,
      awaitingUserIds: ["ana"],
      viewerHasConfirmed: false,
    },
  };
}
