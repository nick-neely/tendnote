import { redirect } from "next/navigation";
import { type AccessState, GUEST_PATH, LAPSED_PATH, REACCEPTANCE_PATH } from "./access-state";
import { getCurrentAccess } from "./current-access";

type UnadmittedAccess = Extract<AccessState, { state: "pending" | "lapsed" }>;

/**
 * The signed-in, not-admitted account a page renders for, whether it never
 * paid or Lapsed. Anyone else goes where they belong: a signed-out visitor to
 * sign-in, an account that owes re-acceptance to the gate (#614), a live
 * Household Guest to the guest area (#635), and an admitted one into the app.
 */
export async function requireUnadmittedAccess(): Promise<UnadmittedAccess> {
  const access = await getCurrentAccess();
  if (access.state === "unauthenticated") redirect("/sign-in");
  if (access.state === "reacceptance") redirect(REACCEPTANCE_PATH);
  if (access.state === "admitted") redirect("/");
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
