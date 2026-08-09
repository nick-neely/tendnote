import type { ContextFactView } from "@tendnote/domain/context-facts";
import { contextFactCategoryLabel } from "@tendnote/domain/context-facts";
import {
  buildHouseholdContextBoard,
  HOUSEHOLD_CONTEXT_SECTION_DESCRIPTION,
  HOUSEHOLD_CONTEXT_SECTION_TITLE,
  type HouseholdContextActorIdentity,
  householdContextAttributionLine,
} from "@tendnote/domain/household-context";
import Link from "next/link";
import { appDestination } from "@/components/app-destinations";

/**
 * Household Context as the Overview shows it: a few current facts and the way to
 * the page that manages them.
 *
 * It is a subset, never a total. No count of what exists, no count of what is
 * missing, no progress toward a complete household description — a household
 * with two shared facts is not behind one with eight, and the Overview is the
 * last place that should imply otherwise.
 *
 * It stays a section under Overview rather than becoming a fourth durable
 * Household destination, which is why the way in is a quiet link beside the
 * heading rather than a button competing with the household's own controls.
 */
export function HouseholdContextSummary({
  facts,
  identities,
  now,
  viewerUserId,
}: {
  facts: readonly ContextFactView[];
  identities: readonly HouseholdContextActorIdentity[];
  now: Date;
  viewerUserId: string;
}) {
  const board = buildHouseholdContextBoard({ facts, summaryLimit: 3 });
  const destination = appDestination("account-household-context");

  return (
    <section aria-labelledby="household-context-summary-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
          id="household-context-summary-heading"
        >
          {HOUSEHOLD_CONTEXT_SECTION_TITLE}
        </h2>
        <Link
          className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35 focus-visible:outline-none"
          href={destination.route}
        >
          Manage household context
        </Link>
      </div>

      {board.summary.length > 0 ? (
        <ul className="divide-y rounded-xl border bg-surface">
          {board.summary.map((fact) => (
            <li className="flex min-w-0 flex-col gap-1 px-4 py-3" key={fact.id}>
              <span className="min-w-0 break-words text-[length:var(--text-body)] leading-[var(--text-body-line)]">
                {fact.content}
              </span>
              <span className="min-w-0 break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
                {contextFactCategoryLabel(fact.category)}
                {" · "}
                {householdContextAttributionLine({ fact, viewerUserId, identities, now }) ??
                  "Shared with everyone here"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="max-w-[65ch] rounded-xl border border-dashed px-4 py-3 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          {HOUSEHOLD_CONTEXT_SECTION_DESCRIPTION}
        </p>
      )}
    </section>
  );
}
