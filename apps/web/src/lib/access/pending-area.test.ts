import { describe, expect, it } from "vitest";
import { pendingAreaView } from "./pending-area";

const facts = {
  checkoutOpen: true,
  startedCheckout: false,
  ownsExportableData: false,
  guestStanding: null,
  betaEnded: false,
} as const;

describe("pendingAreaView (#607)", () => {
  it("tells a never-subscribed account nothing has been charged and offers Subscribe", () => {
    expect(pendingAreaView(facts)).toMatchObject({
      state: "never_subscribed",
      line: "Your account is ready. Nothing has been charged.",
      subscribe: true,
    });
  });

  it("gives an unfinished checkout one line that stays true while a payment is confirming", () => {
    expect(pendingAreaView({ ...facts, startedCheckout: true })).toMatchObject({
      state: "checkout_unfinished",
      title: "Finish subscribing",
      line: "Your subscription hasn't started yet. Just paid? You'll be let in as soon as it's confirmed.",
      subscribe: true,
    });
  });

  it("keeps waiting for Private Beta Access while Checkout is closed, with no Subscribe", () => {
    expect(pendingAreaView({ ...facts, checkoutOpen: false })).toMatchObject({
      state: "awaiting_access",
      subscribe: false,
    });
  });

  it("keeps an unfinished checkout's line when Checkout closes, without Subscribe", () => {
    const view = pendingAreaView({ ...facts, checkoutOpen: false, startedCheckout: true });

    expect(view).toMatchObject({ state: "checkout_unfinished", subscribe: false });
    expect(view.line).toContain("Just paid? You'll be let in as soon as it's confirmed.");
    expect(view.line).not.toContain("Private Beta Access");
  });

  it("offers Export only when the account owns something to export", () => {
    expect(pendingAreaView(facts).exportData).toBe(false);
    expect(pendingAreaView({ ...facts, ownsExportableData: true }).exportData).toBe(true);
    expect(
      pendingAreaView({ ...facts, checkoutOpen: false, ownsExportableData: true }).exportData,
    ).toBe(true);
  });
});

describe("pendingAreaView for a guest that is not one now (#637)", () => {
  const namesSomeone = /owner|billing|paid|payment|subscription|\d/i;

  it("tells a guest its household is not currently active, naming nobody and no date", () => {
    const view = pendingAreaView({ ...facts, guestStanding: "household_inactive" });

    expect(view).toMatchObject({
      state: "household_inactive",
      title: "This household is not currently active on Tendnote",
      subscribe: true,
      exportData: false,
    });
    expect(view.line).toContain("Nothing was deleted");
    expect(`${view.title} ${view.line}`).not.toMatch(namesSomeone);
  });

  it("tells a removed guest its membership ended, naming nobody and no date", () => {
    const view = pendingAreaView({ ...facts, guestStanding: "membership_ended" });

    expect(view).toMatchObject({ state: "membership_ended", subscribe: true, exportData: false });
    expect(`${view.title} ${view.line}`).not.toMatch(namesSomeone);
  });

  it("puts an inactive household ahead of an unfinished checkout, and an ended membership behind it", () => {
    expect(
      pendingAreaView({ ...facts, startedCheckout: true, guestStanding: "household_inactive" })
        .state,
    ).toBe("household_inactive");
    expect(
      pendingAreaView({ ...facts, startedCheckout: true, guestStanding: "membership_ended" }).state,
    ).toBe("checkout_unfinished");
  });

  it("keeps the guest's line but drops Subscribe while Checkout is closed", () => {
    expect(
      pendingAreaView({ ...facts, checkoutOpen: false, guestStanding: "membership_ended" }),
    ).toMatchObject({ state: "membership_ended", subscribe: false });
  });
});

describe("pendingAreaView for an ex-beta account (#612)", () => {
  it("says the beta ended and the data is intact, and offers Subscribe", () => {
    const view = pendingAreaView({ ...facts, betaEnded: true, ownsExportableData: true });

    expect(view).toMatchObject({
      state: "beta_ended",
      title: "The private beta has ended",
      subscribe: true,
      exportData: true,
    });
    expect(view.line).toContain("intact");
    expect(view.line).not.toMatch(/\d/);
  });

  it("keeps the beta-ended line without Subscribe while Checkout is closed", () => {
    const view = pendingAreaView({ ...facts, betaEnded: true, checkoutOpen: false });

    expect(view).toMatchObject({ state: "beta_ended", subscribe: false });
    expect(view.line).not.toContain("Subscribe");
  });

  it("puts an unfinished checkout ahead of the beta ending", () => {
    expect(pendingAreaView({ ...facts, betaEnded: true, startedCheckout: true }).state).toBe(
      "checkout_unfinished",
    );
  });
});
