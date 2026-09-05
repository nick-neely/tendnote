"use client";

import type {
  PersonUpdateStatus,
  PersonUpdateTarget,
  PersonUpdateUndoStatus,
} from "@tendnote/domain";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getPersonUpdateStatusAction, undoPersonUpdateAction } from "@/app/actions/person-updates";

/** Reconciles a mounted recovery target without letting old reads overwrite a click. */
export function usePersonUpdateUndo(target: PersonUpdateTarget) {
  const router = useRouter();
  const [status, setStatus] = useState<PersonUpdateStatus | PersonUpdateUndoStatus>("available");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mutationEpoch = useRef(0);
  const { personId, updateId } = target;

  useEffect(() => {
    let active = true;
    const reconcile = async () => {
      const epoch = mutationEpoch.current;
      try {
        const result = await getPersonUpdateStatusAction({ personId, updateId });
        if (active && epoch === mutationEpoch.current && !inFlight.current && result.ok)
          setStatus(result.view.status);
      } catch {
        /* The click still performs the authoritative check; a read failure is retryable. */
      }
    };
    void reconcile();
    window.addEventListener("focus", reconcile);
    return () => {
      active = false;
      window.removeEventListener("focus", reconcile);
    };
  }, [personId, updateId]);

  async function undo() {
    if (inFlight.current) return;
    inFlight.current = true;
    mutationEpoch.current += 1;
    setPending(true);
    setError(null);
    try {
      const result = await undoPersonUpdateAction(target);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus(result.view.status);
      router.refresh();
    } catch {
      setError("Couldn't confirm the undo. Try again; the same update will only be undone once.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { status, pending, error, undo };
}
