import Link from "next/link";
import { Body, Caption } from "@/components/assistant-result-card";
import type { AssetFactView, AssetSearchResultView } from "@/lib/eve/tool-result-view";
import { cn } from "@/lib/utils";

/**
 * How a result was found, in the user's words. Naming the signal is what keeps a fused
 * search legible instead of magic: "Exact value" tells the user the part number *is*
 * what they typed, while "Related" is honest that the match was only by meaning.
 */
const MATCH_KIND_LABEL: Record<AssetSearchResultView["matchKinds"][number], string> = {
  structured: "Exact value",
  exact: "Exact text",
  semantic: "Related",
};

/**
 * The trust register of an asset record, said plainly. A reviewed memory is a fact; an
 * asset is only the thing; evidence is grounding, not a claim; and a suggestion is a
 * proposal that must never read as truth.
 */
const TRUST_LABEL: Record<AssetSearchResultView["trustLevel"], string> = {
  asset_fact: "Confirmed fact",
  asset_anchor: "Asset",
  asset_evidence: "Evidence on file",
  suggested_asset_fact: "Suggested, needs review",
};

/**
 * One grounded Asset Search result. The exact stored value is the answer to the
 * question the user actually asked ("what filter does the fridge need?"), so it gets
 * its own typographic slot rather than being buried in a snippet — the user should be
 * able to read the part number without parsing a sentence.
 */
export function AssetSearchResultRow({ result }: { result: AssetSearchResultView }) {
  return (
    <div className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Link
          className="font-medium text-sm hover:underline"
          href={`/assets/${result.assetId}`}
          prefetch={false}
        >
          {result.assetName}
        </Link>
        <span className="text-muted-foreground text-xs">{result.label}</span>
      </div>

      {result.value ? (
        <p className="font-mono text-sm tabular-nums">{result.value}</p>
      ) : (
        <Body>{result.snippet}</Body>
      )}

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Caption>
          <span
            className={cn(
              result.trustLevel === "suggested_asset_fact" && "text-amber-700 dark:text-amber-500",
            )}
          >
            {TRUST_LABEL[result.trustLevel]}
          </span>
          {" · "}
          {result.matchKinds.map((kind) => MATCH_KIND_LABEL[kind]).join(" + ")}
          {" · "}
          {result.visibilityLabel}
        </Caption>
      </div>
    </div>
  );
}

/** One reviewed fact on the asset context card — a record, never snapshot prose. */
export function AssetFactRow({ fact }: { fact: AssetFactView }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-muted-foreground text-xs">{fact.label}</span>
        <Caption>{fact.visibilityLabel}</Caption>
      </div>
      {fact.value ? <p className="font-mono text-sm tabular-nums">{fact.value}</p> : null}
      {fact.notes ? <Body>{fact.notes}</Body> : null}
    </div>
  );
}
