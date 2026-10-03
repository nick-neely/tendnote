/**
 * What the pending area knows about a signed-in, not-admitted account. All of
 * it is read from Tendnote's own records; the pending area never asks Stripe.
 */
export type PendingAreaFacts = {
  /** Hosted, Stripe configured, and the Checkout flag on for this account. */
  checkoutOpen: boolean;
  /**
   * A Stripe customer is on record, which Tendnote writes only when Subscribe
   * opens Checkout. Without Paid Access it means a checkout that did not
   * finish: abandoned, declined, or expired. Those look the same from here and
   * mean the same to the customer, so they share one line. So does a paid
   * first invoice still on its way to Paid Access, which is why the line never
   * claims nothing was charged; Subscribe sends that account to the confirming
   * page instead of a second Checkout.
   */
  startedCheckout: boolean;
  /** The account owns records an owner export would carry. */
  ownsExportableData: boolean;
};

export type PendingAreaView = {
  /** Which not-admitted state this is, rendered as a data attribute for tests. */
  state: "awaiting_access" | "never_subscribed" | "checkout_unfinished";
  title: string;
  /** The one line of what happened. */
  line: string;
  /** The Subscribe form, when Checkout is open for this account. */
  subscribe: boolean;
  /** Export only when there is something to export; Delete and Sign out always render. */
  exportData: boolean;
};

/**
 * The pending area's state and actions for one account (#607). One home for
 * every signed-in, not-admitted, not-Lapsed state: one line of what happened
 * and actions by what the account owns. Delete and Sign out are not listed
 * because they are never withheld.
 */
export function pendingAreaView(facts: PendingAreaFacts): PendingAreaView {
  const exportData = facts.ownsExportableData;

  if (!facts.checkoutOpen) {
    return {
      state: "awaiting_access",
      title: "You're on the list",
      line: "Your account is set up and waiting for Private Beta Access. We'll let you in as soon as it's granted. No need to sign up again.",
      subscribe: false,
      exportData,
    };
  }

  if (facts.startedCheckout) {
    return {
      state: "checkout_unfinished",
      title: "Finish subscribing",
      line: "Your subscription hasn't started yet. Just paid? You'll be let in as soon as it's confirmed.",
      subscribe: true,
      exportData,
    };
  }

  return {
    state: "never_subscribed",
    title: "Subscribe to Tendnote",
    line: "Your account is ready. Nothing has been charged.",
    subscribe: true,
    exportData,
  };
}
