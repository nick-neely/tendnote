"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GUEST_PATH } from "@/lib/access/access-state";
import { requireGuestAccess } from "@/lib/access/pending-access";
import {
  GUEST_ORIENTATION_COOKIE,
  GUEST_ORIENTATION_MAX_AGE,
} from "@/lib/household/guest-orientation";

/**
 * The guest has read the one-time orientation (#636). Remembered on this
 * browser for this account only: the cookie holds the account id, so a
 * different guest signing in here still sees their own orientation once.
 */
export async function finishGuestOrientationAction(): Promise<void> {
  const { user } = await requireGuestAccess();
  (await cookies()).set(GUEST_ORIENTATION_COOKIE, user.id, {
    path: GUEST_PATH,
    maxAge: GUEST_ORIENTATION_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  redirect(GUEST_PATH);
}
