"use client";

import { useEffect, useState } from "react";

/**
 * Two-step confirm state with a short arming delay (#200 review). The confirm
 * affordance renders where the trigger just was, so without the delay a
 * double-click would land the "second" step with no real decision — the confirm
 * stays disabled until `armed` flips, then one deliberate click proceeds.
 * `cancel` backs out (blur, Escape); shared by every destructive inline confirm
 * so the timing never drifts between surfaces.
 */
export function useArmedConfirm(armDelayMs = 350) {
  const [confirming, setConfirming] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!confirming) {
      return;
    }
    const timer = window.setTimeout(() => setArmed(true), armDelayMs);
    return () => window.clearTimeout(timer);
  }, [confirming, armDelayMs]);

  function begin(): void {
    setConfirming(true);
    setArmed(false);
  }

  function cancel(): void {
    setConfirming(false);
    setArmed(false);
  }

  return { confirming, armed, begin, cancel };
}
