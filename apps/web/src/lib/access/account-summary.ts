import type { AccessSource } from "@tendnote/domain";
import { type AccessState, GUEST_PATH, REACCEPTANCE_PATH } from "./access-state";

/**
 * Human-readable label for how an admitted user's Private Beta Access was granted,
 * shown on the account page. Avoids echoing the "Private Beta Access" panel title.
 * Pure so it can be unit tested.
 */
export function accessSourceLabel(source: AccessSource | null): string {
  switch (source) {
    case "bootstrap":
      return "Initial owner";
    case "self_hosted_bootstrap":
      return "Self-hosted owner";
    case "household_invitation":
      return "Household invitation";
    case "beta_flag":
      return "Beta invite";
    case "manual_grant":
      return "Granted manually";
    case "paid_access":
      return "Paid Access";
    default:
      return "Granted";
  }
}

/** What the account page should do for a resolved access state. */
export type AccountView =
  | {
      type: "render";
      name: string;
      email: string;
      sourceLabel: string;
      /** The account's standing beside its name: a paying account is not a beta tester. */
      accessBadge: "Paid Access" | "Private beta";
    }
  | {
      type: "redirect";
      to: "/sign-in" | "/pending" | typeof GUEST_PATH | typeof REACCEPTANCE_PATH;
    };

/**
 * Decide whether the account page renders (and with what identity) or redirects.
 * Admitted users see their identity and access source; pending users are sent to
 * the limited pending area; an unauthenticated request renders only when a
 * local-dev fallback owner is supplied (never in production), matching how the
 * rest of the app admits the local owner, otherwise it redirects to sign-in.
 */
export function resolveAccountView(
  access: AccessState,
  fallbackOwnerUserId: string | undefined,
): AccountView {
  if (access.state === "pending") {
    return { type: "redirect", to: "/pending" };
  }

  if (access.state === "reacceptance") {
    return { type: "redirect", to: REACCEPTANCE_PATH };
  }

  if (access.state === "guest") {
    return { type: "redirect", to: GUEST_PATH };
  }

  if (access.state === "admitted") {
    return {
      type: "render",
      name: access.user.name || access.user.email,
      email: access.user.email,
      sourceLabel: accessSourceLabel(access.decision.profile?.source ?? null),
      accessBadge:
        access.decision.profile?.source === "paid_access" ? "Paid Access" : "Private beta",
    };
  }

  if (fallbackOwnerUserId) {
    return {
      type: "render",
      name: "Local development",
      email: fallbackOwnerUserId,
      sourceLabel: "Local development",
      accessBadge: "Private beta",
    };
  }

  return { type: "redirect", to: "/sign-in" };
}
