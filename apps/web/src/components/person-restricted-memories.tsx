"use client";

import { ChevronDownIcon } from "@/components/icons";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * The reveal that puts a person's restricted memories back within reach.
 *
 * Restricted memories are the owner's own confirmed facts, so the person's page
 * should not pretend they do not exist - but they are also the ones you would
 * not want read over your shoulder. So the fold is uncontrolled and starts
 * closed on every visit: nothing about a reveal is stored, in the URL or
 * anywhere else, and coming back to the page closes it again. Radix mounts the
 * body only while open, so a page nobody has opened carries no restricted rows
 * in the DOM at all.
 *
 * The rows themselves are passed in already rendered, so a revealed memory reads
 * exactly like a confirmed one on the ledger above it (same row, same anchor,
 * same read-only treatment) apart from its Restricted marker.
 *
 * Wording follows the search surface's "Reveal restricted matches" control: the
 * label names the control and carries the count, and what restriction actually
 * means lives in helper text the trigger points at.
 */
export function RestrictedMemoriesDisclosure({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Collapsible className="flex flex-col gap-2">
      {/* Matches the Resolved fold on the Follow-Ups tab: `min-h-11` is the 44px
          touch target, and the chevron is what tells the owner this is a control
          rather than a caption counting something they cannot open. */}
      <CollapsibleTrigger
        aria-describedby="restricted-memories-hint"
        className="group -mx-1.5 flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-1.5 text-left text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 shrink-0 transition-transform duration-150 ease-(--motion-ease-out) group-data-[state=open]:rotate-180"
        />
        Restricted ({count})
      </CollapsibleTrigger>
      <p
        className="max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
        id="restricted-memories-hint"
      >
        Kept out of suggestions and drafts unless you ask for them.
      </p>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
