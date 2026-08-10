import { HOUSEHOLD_CHECKIN_HEADING } from "@tendnote/domain/household-checkin";
import type { HouseholdHomeRecord } from "@tendnote/domain/household-home";
import Link from "next/link";
import { type Icon, ListTodoIcon, RepeatIcon } from "@/components/icons";

const FAMILY_ICON: Record<HouseholdHomeRecord["family"], Icon> = {
  action: ListTodoIcon,
  routine: RepeatIcon,
};

/**
 * One member's private Household check-in.
 *
 * Read-first and deliberately quieter than the Household home it draws from: no
 * inline mutation, no count, no badge, no severity colour. The home is where a
 * household acts together; this is a member glancing at what is going on before
 * their day starts, inside their own briefing, and the only affordance a row
 * needs is the canonical link to the record itself. Anything consequential opens
 * that record — which is also what keeps this from becoming an assignment
 * surface (ADR 0220).
 *
 * It is not the Household home's third section and not a digest: at most three
 * rows, chosen deterministically before this component sees them, and rendered
 * identically for every member with the same access.
 *
 * The whole section is absent when there is nothing timely. An empty check-in is
 * a small standing request to go and find something, and this product does not
 * make those — so the caller asks {@link householdCheckinIsWorthShowing} rather
 * than rendering an empty state here.
 */
export function HouseholdCheckinSection({
  householdName,
  records,
  limitations,
  headingId,
}: {
  householdName: string;
  records: readonly HouseholdHomeRecord[];
  limitations: readonly string[];
  headingId: string;
}) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2
          className="font-semibold text-[length:var(--text-title)] leading-[var(--text-title-line)] tracking-normal"
          id={headingId}
        >
          {HOUSEHOLD_CHECKIN_HEADING}
        </h2>
        {/* The boundary, said once and in words: whose records these are, and
            that the list is this member's own view of them. Naming the household
            is what stops a shared row reading as a private obligation. */}
        <p className="text-[length:var(--text-caption)] text-muted-foreground leading-[var(--text-caption-line)]">
          What {householdName} is coordinating, as you can see it.
        </p>
      </div>

      {records.length > 0 ? (
        <ul className="flex list-none flex-col divide-y border-t border-b">
          {records.map((record) => (
            <HouseholdCheckinRow key={record.identity} record={record} />
          ))}
        </ul>
      ) : null}

      {limitations.map((limitation) => (
        <p
          className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
          key={limitation}
          role="status"
        >
          {limitation}
        </p>
      ))}
    </section>
  );
}

/**
 * One record, as text.
 *
 * Every fact the row carries — what kind of thing it is, when it matters, whose
 * it is, and who said they are looking after it — is written out, so the row
 * reads the same to a screen reader, at 200% text, in high contrast, and in
 * monochrome. Attribution and responsibility stay one quiet line and never
 * become pills: a badge reads as a status being reported, and neither of these
 * is one.
 */
function HouseholdCheckinRow({ record }: { record: HouseholdHomeRecord }) {
  const FamilyIcon = FAMILY_ICON[record.family];
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <FamilyIcon aria-hidden className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[length:var(--text-caption)] text-muted-foreground leading-[var(--text-caption-line)]">
          {record.context}
        </p>
        <Link
          className="w-fit font-medium text-[length:var(--text-small)] leading-[var(--text-small-line)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          href={record.record.href}
        >
          {record.title}
        </Link>
        <p className="text-[length:var(--text-caption)] text-muted-foreground leading-[var(--text-caption-line)]">
          {record.timing.explanation}
          {" · "}
          {record.scopeLabel}
          {record.responsibility ? ` · ${record.responsibility}` : null}
        </p>
      </div>
    </li>
  );
}

/** A check-in-shaped reserve: the heading it will have, and rows the size of rows. */
export function HouseholdCheckinReserve() {
  return (
    <section
      aria-busy="true"
      aria-label={`Loading ${HOUSEHOLD_CHECKIN_HEADING}`}
      className="flex flex-col gap-3"
    >
      <h2 className="font-semibold text-[length:var(--text-title)] leading-[var(--text-title-line)] tracking-normal">
        {HOUSEHOLD_CHECKIN_HEADING}
      </h2>
      <div className="flex flex-col divide-y border-t border-b">
        {[0, 1].map((row) => (
          <div className="flex items-start gap-3 py-3" key={row}>
            <div className="size-8 shrink-0 animate-pulse rounded-lg bg-muted/60" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-3 w-14 animate-pulse rounded bg-muted/60" />
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted/60" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
