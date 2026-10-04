import { redirect } from "next/navigation";
import {
  type AccessState,
  GUEST_PATH,
  LAPSED_PATH,
  REACCEPTANCE_PATH,
  RESTRICTED_PATH,
  signedInHome,
} from "./access-state";
import { getCurrentAccess } from "./current-access";

type UnadmittedAccess = Extract<AccessState, { state: "pending" | "lapsed" }>;
type SubscribingAccess = Extract<AccessState, { state: "pending" | "lapsed" | "guest" }>;

/**
 * The signed-in account that may be waiting on its own subscription: never
 * paid, Lapsed, or a live Household Guest, who keeps its membership on paying
 * (#637). Anyone else goes where they belong: a signed-out visitor to sign-in,
 * an account that owes re-acceptance to the gate (#614), and an admitted one
 * into the app.
 */
export async function requireSubscribingAccess(): Promise<SubscribingAccess> {
  const access = await getCurrentAccess();
  if (access.state === "unauthenticated") redirect("/sign-in");
  if (access.state === "restricted") redirect(RESTRICTED_PATH);
  if (access.state === "reacceptance") redirect(REACCEPTANCE_PATH);
  if (access.state === "admitted") redirect("/");
  return access;
}

/**
 * {@link requireSubscribingAccess} for a page a live Household Guest does not
 * belong on: it goes to the guest area (#635).
 */
async function requireUnadmittedAccess(): Promise<UnadmittedAccess> {
  const access = await requireSubscribingAccess();
  if (access.state === "guest") redirect(GUEST_PATH);
  return access;
}

/**
 * The live Household Guest a guest-area page renders for. The guest check is
 * live, so a guest whose household lost its last admitted Owner lands in the
 * pending area on this request, and returns here on the one after it regains
 * one. Everyone else goes where they belong.
 */
export async function requireGuestAccess(): Promise<Extract<AccessState, { state: "guest" }>> {
  const access = await getCurrentAccess();
  if (access.state === "unauthenticated") redirect("/sign-in");
  if (access.state === "restricted") redirect(RESTRICTED_PATH);
  if (access.state === "reacceptance") redirect(REACCEPTANCE_PATH);
  if (access.state === "admitted") redirect("/");
  if (access.state === "pending") redirect("/pending");
  if (access.state === "lapsed") redirect(LAPSED_PATH);
  return access;
}

/** {@link requireUnadmittedAccess} for the pending area; a Lapsed account has its own. */
export async function requirePendingAccess(): Promise<Extract<AccessState, { state: "pending" }>> {
  const access = await requireUnadmittedAccess();
  if (access.state === "lapsed") redirect(LAPSED_PATH);
  return access;
}

/** {@link requireUnadmittedAccess} for the Lapsed area (#609); a never-paid account goes pending. */
export async function requireLapsedAccess(): Promise<Extract<AccessState, { state: "lapsed" }>> {
  const access = await requireUnadmittedAccess();
  if (access.state === "pending") redirect("/pending");
  return access;
}

/**
 * The suspended account the restricted area renders for (#629). Everyone else
 * goes where they belong, so a lifted suspension leaves the area on the next
 * request.
 */
export async function requireRestrictedAccess(): Promise<
  Extract<AccessState, { state: "restricted" }>
> {
  const access = await getCurrentAccess();
  if (access.state === "restricted") return access;
  if (access.state === "unauthenticated") redirect("/sign-in");
  redirect(signedInHome(access));
}
