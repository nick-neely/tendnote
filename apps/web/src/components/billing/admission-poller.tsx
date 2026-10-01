"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_INTERVAL_MS = 2000;

/**
 * Re-renders the confirming page on an interval. The page reads Tendnote's own
 * admission record on each render and redirects once Paid Access lands, so
 * polling never asks Stripe anything.
 */
export function AdmissionPoller() {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  return null;
}
