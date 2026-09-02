import { assistantToolResultSchemas } from "@tendnote/domain";
import type { GlobalRecallResult } from "@tendnote/domain/global-recall";
import Link from "next/link";
import { Body, Caption } from "@/components/assistant-result-card";
import { SearchIcon } from "@/components/icons";
import { labelSensitivity } from "@/lib/eve/agenda-format";
import type { GlobalRecallResultView } from "@/lib/eve/tool-result-view";
import { RECALL_FAMILY_LABELS, recallResultLines } from "@/lib/recall-result-lines";
import { defineModule } from "./module";
import { DisclosureShell, ToolActivityLine } from "./shells";

/**
 * Global Recall as a chat card (ADR 0199).
 *
 * `search_global_recall` has always emitted a `global_recall` component, but no
 * schema claimed the name and no module rendered it, so the one tool that answers
 * cross-domain questions was the one whose answer arrived as a nameless housekeeping
 * line. The rows below are the same rows the desktop palette and the phone's Search
 * flow show: the same two lines from `recallResultLines`, the same family names, and
 * the same `href` the shared normalizer produced, so a result opened from chat lands
 * exactly where the same result opened from search lands.
 *
 * The footnotes are not decoration. Recall reports what it could not reach and
 * whether more matched than fit; a card that showed only the rows would present a
 * partial read of the whole notebook as a complete one.
 */

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

function toGlobalRecallResult(result: GlobalRecallResult): GlobalRecallResultView {
  const { primary, secondary } = recallResultLines(result);
  return {
    family: result.family,
    canonicalKind: result.canonical.kind,
    canonicalId: result.canonical.id,
    href: result.href,
    primary,
    secondary,
    matchKind: result.match.kind,
    visibilityLabel: result.visibility?.label ?? null,
    sensitivity: result.sensitivity,
  };
}

// ---------------------------------------------------------------------------
// Presentational bits
// ---------------------------------------------------------------------------

/** The trailing caption: how the row matched, who may see it, and any delicacy. */
function recallRowCaption(result: GlobalRecallResultView): string {
  return [
    result.matchKind === "related" ? "Related" : "Exact match",
    result.visibilityLabel,
    // "Normal" on every row is noise; a delicate record earns the word.
    result.sensitivity === "normal" ? null : labelSensitivity(result.sensitivity),
  ]
    .filter(Boolean)
    .join(" · ");
}

function GlobalRecallRow({ result }: { result: GlobalRecallResultView }) {
  return (
    <div className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Link
          className="min-w-0 underline decoration-foreground/25 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          href={result.href}
        >
          <span className="truncate font-medium text-foreground">{result.primary}</span>
        </Link>
        <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[length:var(--text-caption)] text-muted-foreground">
          {RECALL_FAMILY_LABELS[result.family]}
        </span>
      </div>
      {result.secondary ? <Body>{result.secondary}</Body> : null}
      <Caption>{recallRowCaption(result)}</Caption>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const globalRecallModule = defineModule<"global_recall">({
  kind: "global_recall",
  parsers: {
    search_global_recall: (output) => {
      const parsed = assistantToolResultSchemas.search_global_recall.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "global_recall",
        query: parsed.data.query,
        results: parsed.data.results.map(toGlobalRecallResult),
        limitations: parsed.data.limitations.map((limitation) => limitation.message),
        hasMore: parsed.data.hasMore,
      };
    },
  },
  // A recall that found nothing still has something to say when it could not reach
  // a source, so an empty-but-limited read keeps the disclosure rather than
  // collapsing to a line that would drop the caveat.
  tier: (view) => (view.results.length > 0 || view.limitations.length > 0 ? "disclosure" : "line"),
  summary: (view) =>
    view.results.length > 0 || view.limitations.length > 0
      ? null
      : "Nothing matching in your records",
  key: (view) =>
    `global-recall:${view.results.map((result) => `${result.canonicalKind}:${result.canonicalId}`).join("|")}`,
  render: (view, isNew) => {
    if (view.results.length === 0 && view.limitations.length === 0) {
      return (
        <ToolActivityLine icon={<SearchIcon aria-hidden className="size-3.5" />} isNew={isNew}>
          Nothing matching in your records
        </ToolActivityLine>
      );
    }
    const count = view.results.length;
    return (
      <DisclosureShell
        icon={<SearchIcon aria-hidden className="size-3.5 shrink-0" />}
        isNew={isNew}
        summary={
          count === 1
            ? "Found 1 match across your records"
            : `Found ${count} matches across your records`
        }
        toolView={view.kind}
      >
        <div className="flex flex-col border-t px-3.5 pt-3 pb-3.5">
          {count > 0 ? (
            <div className="flex flex-col divide-y divide-border/70">
              {view.results.map((result) => (
                <GlobalRecallRow
                  key={`${result.canonicalKind}:${result.canonicalId}`}
                  result={result}
                />
              ))}
            </div>
          ) : null}
          {view.limitations.length > 0 || view.hasMore ? (
            <div className={count > 0 ? "mt-3 flex flex-col gap-1" : "flex flex-col gap-1"}>
              {view.limitations.map((limitation) => (
                <Caption key={limitation}>{limitation}</Caption>
              ))}
              {view.hasMore ? (
                <Caption>More matches than fit here. Narrow the search to see them.</Caption>
              ) : null}
            </div>
          ) : null}
        </div>
      </DisclosureShell>
    );
  },
});
