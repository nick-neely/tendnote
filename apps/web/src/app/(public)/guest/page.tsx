import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { GuestLibraryView } from "@/components/guest/guest-library";
import { GuestOrientation } from "@/components/guest/guest-orientation";
import { requireGuestAccess } from "@/lib/access/pending-access";
import { isCheckoutOpen } from "@/lib/billing/checkout-availability";
import { readGuestLibrary } from "@/lib/household/guest-library";
import { selectGuestShelf } from "@/lib/household/guest-library-view";
import {
  GUEST_ORIENTATION_COOKIE,
  hasSeenGuestOrientation,
} from "@/lib/household/guest-orientation";

export const metadata = { title: "Guest", robots: { index: false, follow: false } };

/**
 * Where a live Household Guest lives (#635, #636): its own chrome, never the app
 * shell. A one-time orientation, then the read-only library. Access is checked
 * live on every request, so a guest whose household lost its last paying Owner
 * lands in the pending area on the next one.
 */
export default async function GuestPage({
  searchParams,
}: {
  searchParams?: Promise<{ shelf?: string; record?: string }>;
} = {}) {
  if (process.env.NODE_ENV !== "test") await connection();
  const { user } = await requireGuestAccess();

  const [library, checkoutOpen, cookieStore, params] = await Promise.all([
    readGuestLibrary(user.id),
    isCheckoutOpen(user),
    cookies(),
    searchParams,
  ]);
  // The membership ended between the access check and this read.
  if (!library) redirect("/pending");

  if (!hasSeenGuestOrientation(cookieStore.get(GUEST_ORIENTATION_COOKIE)?.value, user.id)) {
    return <GuestOrientation householdName={library.householdName} />;
  }

  const { shelf, record } = selectGuestShelf(library, params ?? {});
  return (
    <GuestLibraryView
      library={library}
      shelf={shelf}
      record={record}
      user={user}
      canSubscribe={checkoutOpen}
    />
  );
}
