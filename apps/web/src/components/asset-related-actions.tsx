import Link from "next/link";
import { ActionRoutineChip } from "@/components/general-action-shared";
import { ArrowUpRightIcon } from "@/components/icons";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import type { AssetRelatedActionView } from "@/lib/asset-related-action-view";

/**
 * The Asset Profile's minimal related-actions section (#199): the General Actions
 * this asset is linked to, each a quiet ledger row — title, Routine cadence when
 * it has one, and one calm timing/status word. Rows deep-link into the Actions
 * surface (`/actions#action-<id>`), which scrolls to and highlights the row;
 * lifecycle stays over there — the profile only shows the connection.
 */
export function AssetRelatedActions({ actions }: { actions: AssetRelatedActionView[] }) {
  if (actions.length === 0) {
    return <LedgerEmpty>No related actions yet.</LedgerEmpty>;
  }

  return (
    <LedgerList>
      {actions.map((action) => (
        <AssetRelatedActionRow action={action} key={action.id} />
      ))}
    </LedgerList>
  );
}

function AssetRelatedActionRow({ action }: { action: AssetRelatedActionView }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <Link
          className="group inline-flex w-fit max-w-full items-center gap-1 rounded-sm text-[length:var(--text-body)] leading-[var(--text-body-line)] underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[resolved=true]:text-muted-foreground"
          data-resolved={action.resolved}
          href={`/actions#action-${action.id}`}
        >
          <span className="truncate text-pretty">{action.title}</span>
          <ArrowUpRightIcon
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
          />
        </Link>
        {action.recurrenceLabel ? <ActionRoutineChip label={action.recurrenceLabel} /> : null}
      </div>
      <span className="shrink-0 pt-0.5 font-mono text-[length:var(--text-caption)] text-muted-foreground">
        {action.metaLabel}
      </span>
    </div>
  );
}
