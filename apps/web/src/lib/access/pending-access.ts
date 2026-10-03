import { redirect } from "next/navigation";
import { type AccessState, GUEST_PATH, REACCEPTANCE_PATH } from "./access-state";
import { getCurrentAccess } from "./current-access";

/**
 * The signed-in, not-admitted account a pending-area page renders for. Anyone
 * else goes where they belong: a signed-out visitor to sign-in, an account that
 * owes re-acceptance to the gate (#614), a live Household Guest to the guest
 * area (#635), and an admitted one into the app.
 */
export async function requirePendingAccess(): Promise<Extract<AccessState, { state: "pending" }>> {
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
  return access;
}
