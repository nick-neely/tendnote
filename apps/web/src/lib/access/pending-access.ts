import { redirect } from "next/navigation";
import { type AccessState, REACCEPTANCE_PATH } from "./access-state";
import { getCurrentAccess } from "./current-access";

/**
 * The signed-in, not-admitted account a pending-area page renders for. Anyone
 * else goes where they belong: a signed-out visitor to sign-in, an account that
 * owes re-acceptance to the gate (#614), and an admitted one into the app.
 */
export async function requirePendingAccess(): Promise<Extract<AccessState, { state: "pending" }>> {
  const access = await getCurrentAccess();
  if (access.state === "unauthenticated") redirect("/sign-in");
  if (access.state === "reacceptance") redirect(REACCEPTANCE_PATH);
  if (access.state === "admitted") redirect("/");
  return access;
}
