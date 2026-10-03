/** Remembers, per browser and account, that a guest has read the orientation. */
export const GUEST_ORIENTATION_COOKIE = "tn_guest_oriented";

/** A year: long enough to be "once", short enough not to be forever. */
export const GUEST_ORIENTATION_MAX_AGE = 60 * 60 * 24 * 365;

/** Whether this account has read the orientation in this browser. */
export function hasSeenGuestOrientation(cookieValue: string | undefined, userId: string): boolean {
  return cookieValue === userId;
}
