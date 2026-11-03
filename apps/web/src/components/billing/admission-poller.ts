"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

/**
 * How often the confirming page re-reads Tendnote's admission record, by how
 * long it has been waiting (#765). Checks start every two seconds so an
 * ordinary payment lets the customer in promptly, then back off. Each step
 * applies while the time waited so far is under its `untilMs`.
 */
export const ADMISSION_POLL_STEPS = [
  { untilMs: 30_000, everyMs: 2_000 },
  { untilMs: 60_000, everyMs: 5_000 },
  { untilMs: 120_000, everyMs: 10_000 },
  { untilMs: 300_000, everyMs: 30_000 },
] as const;

/**
 * After five minutes the page stops checking on its own and offers a manual
 * check. Admission never depends on this page: the "you're in" email arrives
 * whenever it lands. The schedule allows at most 33 automatic checks.
 */
export const AUTOMATIC_POLLING_WINDOW_MS = 300_000;

/** A manual check ignores repeat presses for this long. */
export const MANUAL_CHECK_COOLDOWN_MS = 2_000;

/** Milliseconds to wait before the next automatic check, or `null` once the window is spent. */
export function admissionPollDelay(elapsedMs: number): number | null {
  if (elapsedMs >= AUTOMATIC_POLLING_WINDOW_MS) return null;
  const step = ADMISSION_POLL_STEPS.find(({ untilMs }) => elapsedMs < untilMs);
  return step ? step.everyMs : null;
}

const isHidden = () => document.visibilityState === "hidden";

/**
 * Re-renders the confirming page on a bounded schedule. The page reads
 * Tendnote's own admission record on each render and redirects once Paid
 * Access lands, so a check never asks Stripe anything and can never grant
 * access by itself.
 *
 * Checks pause while the page is hidden. On return an overdue check runs once,
 * without catching up on the ones skipped, and the window keeps counting from
 * the first render, so hiding the page never extends it. Once the window is
 * spent, `stopped` turns true and `checkAgain` is the only way to check.
 */
export function useAdmissionPolling(): {
  stopped: boolean;
  checking: boolean;
  checkAgain: () => void;
} {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);
  const [checking, setChecking] = useState(false);
  const cooldown = useRef<number | undefined>(undefined);
  const refresh = useEffectEvent(() => router.refresh());

  useEffect(() => {
    const startedAt = Date.now();
    const windowEndsAt = startedAt + AUTOMATIC_POLLING_WINDOW_MS;
    let dueAt: number | null = startedAt + ADMISSION_POLL_STEPS[0].everyMs;
    let timer: number | undefined;

    const stop = () => {
      dueAt = null;
      window.clearTimeout(timer);
      setStopped(true);
    };

    const arm = () => {
      window.clearTimeout(timer);
      if (dueAt === null || isHidden()) return;
      timer = window.setTimeout(check, Math.max(0, dueAt - Date.now()));
    };

    function check() {
      if (dueAt === null || isHidden()) return;
      const now = Date.now();
      const delay = admissionPollDelay(now - startedAt);
      if (delay === null) {
        stop();
      } else {
        dueAt = Math.min(now + delay, windowEndsAt);
        arm();
      }
      // Scheduled first, so a refresh that throws still leaves the next check in place.
      refresh();
    }

    const onVisibilityChange = () => {
      if (dueAt === null) return;
      if (isHidden()) {
        window.clearTimeout(timer);
      } else if (Date.now() > windowEndsAt) {
        stop();
      } else {
        arm();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    arm();
    return () => {
      dueAt = null;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(cooldown.current), []);

  const checkAgain = useCallback(() => {
    if (cooldown.current !== undefined) return;
    setChecking(true);
    cooldown.current = window.setTimeout(() => {
      cooldown.current = undefined;
      setChecking(false);
    }, MANUAL_CHECK_COOLDOWN_MS);
    router.refresh();
  }, [router]);

  return { stopped, checking, checkAgain };
}
