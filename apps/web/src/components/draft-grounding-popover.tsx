"use client";

import { InfoIcon } from "lucide-react";
import { Caption } from "@/components/assistant-result-card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** A draft's grounding line, reduced to what the popover shows: its trust tier and label. */
export type DraftGroundingItem = { trust: string; label: string };

const TRUST_LABEL: Record<string, string> = {
  confirmed_fact: "Confirmed",
  logged_context: "You noted",
  tentative: "Unconfirmed",
  intent: "Follow-up",
  entry_point: "Surfaced from",
};

/**
 * The quiet "why this draft, and it's private" disclosure, shared by every draft
 * surface (in-chat card and person ledger). The grounding — which can run long — and
 * the privacy reassurance stay collapsed behind one info trigger so the draft itself
 * leads instead of a wall of provenance. Always available; when there's no grounding
 * it still carries the privacy note.
 */
export function DraftGroundingPopover({ grounding }: { grounding: DraftGroundingItem[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="text-muted-foreground" size="sm" type="button" variant="ghost">
          <InfoIcon />
          About this draft
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="flex flex-col gap-2.5">
          {grounding.length ? (
            <div className="flex flex-col gap-1.5">
              <Caption>Why this draft was written</Caption>
              <ul className="flex flex-col gap-1">
                {grounding.map((item) => (
                  <li
                    className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
                    key={`${item.trust}:${item.label}`}
                  >
                    <span className="font-medium text-foreground/70">
                      {TRUST_LABEL[item.trust] ?? item.trust}:
                    </span>{" "}
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="border-t pt-2.5 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
            Private Tendnote draft. Nothing is sent or created outside Tendnote — copy it to send
            yourself.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
