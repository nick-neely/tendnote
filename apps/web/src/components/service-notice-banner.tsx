import { cacheLife } from "next/cache";
import { Suspense } from "react";
import { cacheProfiles } from "@/lib/cache/cache-profiles";
import { fetchServiceNotice } from "@/lib/service-notice/service-notice";

async function readServiceNotice() {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  return fetchServiceNotice(process.env.TENDNOTE_STATUS_PAGE_URL);
}

/**
 * The in-app copy of the status page's Service Notice, shown above every
 * admitted destination and on the signed-out and pending screens while one is
 * posted. It is operator text, content-free
 * and naming no customer, so it is the same for everyone.
 */
async function ServiceNoticeBanner({ rounded }: { rounded: boolean }) {
  const notice = await readServiceNotice();
  if (!notice) return null;

  return (
    <div
      className={`${rounded ? "rounded-lg border" : "border-b"} border-warning/40 bg-warning/10 px-4 py-2 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-foreground sm:px-6`}
      role="status"
    >
      <span className="font-medium">Service notice:</span> {notice.message}
    </div>
  );
}

/** The banner behind its own boundary, so a slow status host never holds the shell. */
export function ServiceNotice({ rounded = false }: { rounded?: boolean }) {
  return (
    <Suspense fallback={null}>
      <ServiceNoticeBanner rounded={rounded} />
    </Suspense>
  );
}
