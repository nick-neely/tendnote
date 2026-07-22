"use client";

import { useEffect, useState } from "react";
import { MobileFailureState } from "@/components/mobile-failure-state";
import { Button } from "@/components/ui/button";

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
      <div className="fixed inset-x-4 top-[calc(1rem+env(safe-area-inset-top))] z-50 mx-auto max-w-md md:top-4">
        <MobileFailureState kind="cache_mismatch" onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (registrationFailed) {
    return (
      <div
        className="fixed inset-x-4 top-[calc(1rem+env(safe-area-inset-top))] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border bg-background p-3 shadow-sm md:top-4"
        role="status"
      >
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
    <div
      className="fixed inset-x-4 top-[calc(1rem+env(safe-area-inset-top))] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border bg-background p-3 shadow-sm md:top-4"
      role="status"
    >
      <p className="text-sm">An update is ready. Finish what you're typing first.</p>
      <Button className="min-h-11" onClick={applyUpdate} size="sm" type="button" variant="outline">
        Update
      </Button>
    </div>
  );
}
