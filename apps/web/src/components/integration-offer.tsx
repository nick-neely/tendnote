"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { closeIntegrationOfferAction } from "@/app/actions/first-run";
import { appDestination } from "@/components/app-destinations";
import { Button } from "@/components/ui/button";

/**
 * The integrations offer, made once First Value is reached and never before it
 * (#565, #639): manual capture is the whole first sitting, and imports and
 * connections are accelerants for after it. Following the link or setting it
 * aside both close it for good; the Account page keeps every connection
 * reachable either way.
 */
export function IntegrationOffer() {
  // Home mounts its phone and desktop trees together, so this renders twice.
  const headingId = useId();
  const [closed, setClosed] = useState(false);
  if (closed) return null;

  function close() {
    setClosed(true);
    void closeIntegrationOfferAction().catch(() => {});
  }

  return (
    <aside
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-surface px-4 py-4"
      data-integration-offer
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          className="font-medium text-[length:var(--text-body)] leading-[var(--text-body-line)]"
          id={headingId}
        >
          Want Tendnote to fill in some of this for you?
        </h2>
        <p className="max-w-[65ch] text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          Import people from Google Contacts, or connect the calendar and email you already use.
          Each one is optional, and each asks before it connects.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild className="min-h-11" variant="outline">
          <Link href={`${appDestination("account").route}#integrations`} onClick={close}>
            See integrations
          </Link>
        </Button>
        <Button className="min-h-11" onClick={close} type="button" variant="ghost">
          Not now
        </Button>
      </div>
    </aside>
  );
}
