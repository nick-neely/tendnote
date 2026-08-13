import type { HouseholdCoordinationRecord } from "@tendnote/domain/household-home";
import Link from "next/link";
import type { ReactNode } from "react";
import { GiftIcon, type Icon, ListTodoIcon, RepeatIcon } from "@/components/icons";

/**
 * The one row every Household surface renders a shared record with.
 *
 * The Household home and the check-in list the same objects one scroll apart,
 * and while each owned its own markup they drifted: the same record was a 16px
 * title in one list and a 13px one in the other, its timing was Small above and
 * Caption below. So the anatomy lives here once and both surfaces compose it —
 * what differs between them is what a row can *do*, not what it looks like.
 */
const FAMILY_ICON: Record<HouseholdCoordinationRecord["family"], Icon> = {
  action: ListTodoIcon,
  routine: RepeatIcon,
  gift_plan: GiftIcon,
};

/**
 * The heading a Household section wears on the Household page.
 *
 * Shared rather than repeated: three sections sit under one heading on that page
 * (both home sections, the check-in) plus the unavailable state that stands in
 * for one of them, and a heading treatment copied four times is a heading
 * treatment that will disagree with itself.
 */
export const HOUSEHOLD_SECTION_HEADING_CLASS =
  "font-semibold text-[length:var(--text-h2)] leading-[var(--text-h2-line)] tracking-normal";

/**
 * One shared record, as text.
 *
 * Three lines and never more:
 *
 * - **Caption** — what kind of thing it is, and its cadence. Dense metadata,
 *   which is what Caption is for.
 * - **Title** — the record itself, and the row's canonical link. A list row name
 *   is Title in this product's scale, whatever surface the list is on.
 * - **Small** — why it is in this section, whose it is, and who said they are
 *   looking after it, joined with `·` into one line. Three separate facts, but
 *   never three stacked lines: the row would tower, and the reader is scanning a
 *   list, not reading a record. Small rather than Caption because "Due today" is
 *   the reason the row is here at all, and 11px muted is not where the fact a
 *   member came for should live.
 *
 * Every fact is written out, so the row reads the same to a screen reader, at
 * 200% text, in high contrast, and in monochrome. Nothing is a pill: a badge
 * reads as a status the row is reporting, and none of these is one.
 */
export function HouseholdRecordRow({
  action = null,
  busy = false,
  focusIdentity,
  record,
}: {
  /**
   * The row's one control, at the row's end from `sm` up and stacked beneath the
   * text on a phone, where there is no room for both. Surfaces that only read —
   * the check-in — pass nothing.
   */
  action?: ReactNode;
  busy?: boolean;
  /**
   * Marks the row for the home's focus restoration. Only the Household home
   * passes it: the check-in lists the same records one scroll below on the same
   * page, and a second element carrying the same identity would let the home's
   * focus query land in the wrong list.
   */
  focusIdentity?: string;
  record: HouseholdCoordinationRecord;
}) {
  const FamilyIcon = FAMILY_ICON[record.family];
  return (
    <li
      aria-busy={busy || undefined}
      className="flex items-start gap-3 py-3"
      data-household-row={focusIdentity}
    >
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <FamilyIcon aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[length:var(--text-caption)] text-muted-foreground leading-[var(--text-caption-line)]">
            {record.context}
          </p>
          <Link
            className="w-fit font-medium text-[length:var(--text-title)] leading-[var(--text-title-line)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href={record.record.href}
          >
            {record.title}
          </Link>
          <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
            {record.timing.explanation}
            {" · "}
            {record.scopeLabel}
            {record.responsibility ? ` · ${record.responsibility}` : null}
          </p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </li>
  );
}

/**
 * A row-shaped reserve: the same three lines, at the heights they will occupy.
 *
 * The bars are shorter than their line boxes so a loading list stays calm, but
 * each box is the real line box, so nothing moves when the text arrives.
 */
export function HouseholdRecordRowReserve({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 size-9 shrink-0 animate-pulse rounded-lg bg-muted/60" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ReserveLine bar="h-2.5" box="h-4" width="w-16" />
          <ReserveLine bar="h-4" box="h-6" width="w-2/3" />
          <ReserveLine bar="h-3" box="h-5" width="w-1/2" />
        </div>
        {withAction ? (
          // Sized and shaped like the `sm` Button the row will hold, down to its
          // radius, so the control does not change silhouette on arrival.
          <div className="h-11 w-32 shrink-0 animate-pulse rounded-[min(var(--radius-md),12px)] bg-muted/60 sm:h-8" />
        ) : null}
      </div>
    </div>
  );
}

/** One reserved line of text: the box the text will fill, and a quieter bar inside it. */
export function ReserveLine({ bar, box, width }: { bar: string; box: string; width: string }) {
  return (
    <div className={`flex ${box} items-center`}>
      <div className={`${bar} ${width} animate-pulse rounded bg-muted/60`} />
    </div>
  );
}
