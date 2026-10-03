import { describe, expect, it } from "vitest";
import { pendingAreaView } from "./pending-area";

const facts = { checkoutOpen: true, startedCheckout: false, ownsExportableData: false };

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
    expect(pendingAreaView({ ...facts, checkoutOpen: false, startedCheckout: true })).toMatchObject(
      { state: "awaiting_access", subscribe: false },
    );
  });

  it("offers Export only when the account owns something to export", () => {
    expect(pendingAreaView(facts).exportData).toBe(false);
    expect(pendingAreaView({ ...facts, ownsExportableData: true }).exportData).toBe(true);
    expect(
      pendingAreaView({ checkoutOpen: false, startedCheckout: false, ownsExportableData: true })
        .exportData,
    ).toBe(true);
  });
});
