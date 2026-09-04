"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCwIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

/**
 * Re-fetches the Contact Import Preview. The route is dynamic, so a refresh
 * pulls fresh provider data and new candidate fingerprints — the real recovery
 * path when a row drifted since it was reviewed. A visible control means the
 * owner is never dependent on a transient toast to get back to a good state.
 */
export function RefreshPreviewButton() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  return (
    <Button
      className="self-start"
      disabled={refreshing}
      onClick={() => {
        setRefreshing(true);
        router.refresh();
        // The route re-renders and this control remounts, so the flag is just a
        // brief guard against double taps while the fetch is in flight.
        window.setTimeout(() => setRefreshing(false), 1500);
      }}
      size="sm"
      variant="outline"
    >
      <RefreshCwIcon
        aria-hidden
        className={refreshing ? "animate-spin" : undefined}
        data-icon="inline-start"
      />
      Refresh preview
    </Button>
  );
}
