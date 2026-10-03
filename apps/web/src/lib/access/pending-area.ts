import type { GuestStanding } from "@tendnote/db/queries/access-profiles";

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
  /**
   * Why a hosted account lost a guest view it had (#637), or `null` when it
   * never had one.
   */
  guestStanding: GuestStanding | null;
};

export type PendingAreaView = {
  /** Which not-admitted state this is, rendered as a data attribute for tests. */
  state:
    | "awaiting_access"
    | "never_subscribed"
    | "checkout_unfinished"
    | "household_inactive"
    | "membership_ended";
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

  // A guest that lost its view hears what happened, and nothing more: no
  // Owner, no billing detail, no date, nobody to chase (#637). A household
  // without a paying Owner is today's news, so it comes first.
  if (facts.guestStanding === "household_inactive") {
    return {
      state: "household_inactive",
      title: "This household is not currently active on Tendnote",
      line: "Nothing was deleted and your membership hasn't changed. Your view comes back as soon as the household is active again.",
      subscribe: facts.checkoutOpen,
      exportData,
    };
  }

  // What happened to the account comes first and never depends on whether
  // Checkout is open right now; availability only decides whether Subscribe
  // renders. A flag turned off or a flag outage must not rewrite an unfinished
  // checkout into a beta waiting list.
  if (facts.startedCheckout) {
    return {
      state: "checkout_unfinished",
      title: facts.checkoutOpen ? "Finish subscribing" : "Your subscription hasn't started",
      line: facts.checkoutOpen
        ? "Your subscription hasn't started yet. Just paid? You'll be let in as soon as it's confirmed."
        : "Just paid? You'll be let in as soon as it's confirmed. Otherwise, subscribing isn't available right now.",
      subscribe: facts.checkoutOpen,
      exportData,
    };
  }

  // An ended membership may be old news; an unfinished checkout is not.
  if (facts.guestStanding === "membership_ended") {
    return {
      state: "membership_ended",
      title: "Your household membership ended",
      line: "You no longer have access to the household's records. Your own account is unchanged.",
      subscribe: facts.checkoutOpen,
      exportData,
    };
  }

  if (!facts.checkoutOpen) {
    return {
      state: "awaiting_access",
      title: "You're on the list",
      line: "Your account is set up and waiting for Private Beta Access. We'll let you in as soon as it's granted. No need to sign up again.",
      subscribe: false,
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
