import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import type { AssetHistoryEntryView } from "@/lib/asset-history-view";

/**
 * The Asset Profile's derived History section (#202): a read-only, newest-first
 * story — when the asset arrived, was archived or restored, which details were
 * confirmed, and what happened with its related actions. Each row is a calm
 * label, the record it names, and a plain date in quiet mono. Action rows
 * deep-link into the Actions surface: General Action lifecycle stays the one
 * source of truth for action history (#196) — this list only retells it.
 */
export function AssetHistory({ entries }: { entries: AssetHistoryEntryView[] }) {
  if (entries.length === 0) {
    return (
      <LedgerEmpty>
        Nothing has happened here yet. Confirmed details, replacements, and archive moments will be
        written here.
      </LedgerEmpty>
    );
  }

  return (
    <LedgerList>
      {entries.map((entry) => (
        <AssetHistoryRow entry={entry} key={entry.id} />
      ))}
    </LedgerList>
  );
}

function AssetHistoryRow({ entry }: { entry: AssetHistoryEntryView }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <p className="min-w-0 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        <span className="font-medium">{entry.label}</span>
        {entry.detail ? (
          entry.actionId ? (
            <Link
              className="group ml-2 inline-flex max-w-full items-center gap-1 rounded-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              href={`/actions#action-${entry.actionId}`}
            >
              <span className="truncate">{entry.detail}</span>
              <ArrowUpRightIcon
                aria-hidden
                className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
              />
            </Link>
          ) : (
            <span className="ml-2 text-muted-foreground">{entry.detail}</span>
          )
        ) : null}
      </p>
      <time
        className="shrink-0 font-mono text-[length:var(--text-caption)] text-muted-foreground"
        dateTime={entry.atISO}
      >
        {entry.atLabel}
      </time>
    </div>
  );
}
