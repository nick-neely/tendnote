"use client";

import { useEffect, useState } from "react";
import { MobileFailureState } from "@/components/mobile-failure-state";
import { Button } from "@/components/ui/button";

/**
 * Where a service-worker notice sits, on every breakpoint.
 *
 * One constant for all three states because they are one overlay in three
 * moods, and the position is the part that has to be right: it is `fixed` at
 * `z-50`, so anything it lands on becomes unclickable.
 *
 * The `lg` placement is the whole point. From `lg` up, `app-shell.tsx` renders a
 * `sticky top-0 z-10 h-14` header whose right-hand group *is* the primary
 * navigation, and a top-centred overlay at `z-50` lands squarely on it — the
 * owner then cannot reach Today, People, or Actions at all until they press
 * Update, and this notice has no dismiss. The Instant matrix caught it on
 * Firefox as a 60-second click timeout naming this overlay as intercepting
 * pointer events, and `assertDestinationAccessibility` now fails on the same
 * shape rather than waiting for a click to time out.
 *
 * So on desktop it moves to the bottom, which is also where a persistent notice
 * belongs on a layout with a top navigation bar. Measured against the built
 * stylesheet rather than reasoned about: below the header it would still cover
 * each surface's `h1`, because desktop content starts immediately under the
 * 3.5rem header. Small screens keep the top placement — their navigation is the
 * bottom bar, which the same move would break.
 */
const NOTICE_POSITION =
  "fixed inset-x-4 top-[calc(1rem+env(safe-area-inset-top))] z-50 mx-auto max-w-md md:top-4 lg:top-auto lg:bottom-4";

const NOTICE_SURFACE =
  `${NOTICE_POSITION} flex items-center justify-between gap-3 rounded-xl border bg-background p-3 shadow-sm` as const;

export function PwaRegistration() {
  const [cacheMismatch, setCacheMismatch] = useState(false);
  const [registrationFailed, setRegistrationFailed] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    const showWaiting = () => setWaiting(registration?.waiting ?? null);
    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === "CACHE_VERSION_MISMATCH") setCacheMismatch(true);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((nextRegistration) => {
        registration = nextRegistration;
        showWaiting();
        nextRegistration.addEventListener("updatefound", () => {
          const installing = nextRegistration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              showWaiting();
            }
          });
        });
      })
      .catch(() => setRegistrationFailed(true));

    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  function applyUpdate() {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {
      once: true,
    });
    waiting.postMessage({ type: "SKIP_WAITING" });
  }

  if (cacheMismatch) {
    return (
      <div className={NOTICE_POSITION}>
        <MobileFailureState kind="cache_mismatch" onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (registrationFailed) {
    return (
      <div className={NOTICE_SURFACE} role="status">
        <p className="text-sm">
          Tendnote can't install on this device. It still works in the browser.
        </p>
        <Button
          className="min-h-11"
          onClick={() => setRegistrationFailed(false)}
          size="sm"
          type="button"
          variant="outline"
        >
          Continue
        </Button>
      </div>
    );
  }
  if (!waiting) return null;
  return (
    <div className={NOTICE_SURFACE} role="status">
      <p className="text-sm">An update is ready. Finish what you're typing first.</p>
      <Button className="min-h-11" onClick={applyUpdate} size="sm" type="button" variant="outline">
        Update
      </Button>
    </div>
  );
}
