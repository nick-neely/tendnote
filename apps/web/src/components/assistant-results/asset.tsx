import { type AssetMemoryProposalToolResult, assistantToolResultSchemas } from "@tendnote/domain";
import { Body, Caption, ResultCard } from "@/components/assistant-result-card";
import { AssetFactRow, AssetSearchResultRow } from "@/components/eve-asset-cards";
import { PackageIcon } from "@/components/icons";
import { formatAssetMemoryValue } from "@/lib/asset-memory-value";
import type { AssetReviewGroupView } from "@/lib/asset-review-view";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";
import { defineModule } from "./module";
import { flagIsFalse } from "./shared";
import { DisclosureShell, ToolActivityLine } from "./shells";

/**
 * Asset result modules (#227): unified Asset Search, grouped Asset Memory review,
 * and snapshot-backed Asset context. Each preserves exact stored values, trust
 * labels, citations, and visibility filtering, and keeps the record/snapshot-prose
 * separation local — a fallback snapshot is never shown as truth, and generated
 * prose never round-trips as a fact.
 */

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

/**
 * The Asset Review Group Eve just proposed, as the same card view the Review tab
 * uses — one review surface. A just-proposed group has no evidence yet and was not
 * promoted from a General Action; the value label is computed here from the typed
 * value, so the exact stored fact never reaches the card as pre-rendered prose.
 */
function toAssetReviewGroupChatView(parsed: AssetMemoryProposalToolResult): AssetReviewGroupView {
  return {
    groupId: parsed.groupId,
    asset: parsed.asset,
    memories: parsed.memories.map((memory) => ({
      id: memory.id,
      label: memory.label,
      value: memory.value,
      valueLabel: formatAssetMemoryValue(memory.value),
      notes: memory.notes,
    })),
    evidence: [],
    duplicates: parsed.duplicates,
    source: parsed.source,
    fromAction: null,
    pendingCount: parsed.pendingCount,
  };
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

/**
 * The loaded Asset, as a chat card. Its layout carries the trust model: reviewed
 * facts lead (they are the records), evidence is named rather than asserted, and
 * the generated summary comes last, explicitly labeled as a cache. A stale summary
 * is dropped at parse time and simply does not appear.
 */
function AssetContextCard({
  view,
  isNew,
}: {
  view: Extract<AssistantToolView, { kind: "asset_context" }>;
  isNew: boolean;
}) {
  return (
    <ResultCard
      footer={<Caption>{assetContextFooter(view)}</Caption>}
      icon={<PackageIcon className="size-3" />}
      isNew={isNew}
      kind={view.kind}
      label={view.assetName ?? "Asset"}
      tone="confirmed"
    >
      <div className="flex flex-col gap-3">
        {view.facts.length > 0 ? (
          <div className="flex flex-col divide-y divide-border/70">
            {view.facts.map((fact) => (
              <AssetFactRow fact={fact} key={fact.memoryId} />
            ))}
          </div>
        ) : (
          <Body>Nothing recorded about this yet.</Body>
        )}

        {view.evidence.length > 0 ? (
          <Caption>
            On file: {view.evidence.map((item) => `${item.label} (${item.kind})`).join(", ")}
          </Caption>
        ) : null}

        {view.actions.length > 0 ? (
          <Caption>Related work: {view.actions.map((action) => action.title).join(", ")}</Caption>
        ) : null}

        {view.summary ? (
          <div className="border-border/70 border-t pt-2.5">
            <Caption>Summary: generated from the facts above, not a source of truth</Caption>
            <p className="mt-1 whitespace-pre-line text-muted-foreground text-sm">{view.summary}</p>
          </div>
        ) : null}
      </div>
    </ResultCard>
  );
}

/** What the card stands on, counted: facts, evidence, and whether the summary survived. */
function assetContextFooter(view: Extract<AssistantToolView, { kind: "asset_context" }>): string {
  const facts =
    view.facts.length === 1 ? "1 confirmed fact" : `${view.facts.length} confirmed facts`;
  const evidence =
    view.evidence.length > 0
      ? ` · ${view.evidence.length === 1 ? "1 item" : `${view.evidence.length} items`} of evidence on file`
      : "";
  const stale = view.snapshotStatus === "fallback" ? " · summary unavailable" : "";

  return `${facts}${evidence}${stale}`;
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

/** Unified Asset Search: grounded records only, each with why it matched and its visibility. */
export const assetSearchModule = defineModule<"asset_search">({
  kind: "asset_search",
  parsers: {
    search_assets: (output) => {
      const parsed = assistantToolResultSchemas.search_assets.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "asset_search",
        query: parsed.data.query,
        results: parsed.data.results.map((result) => ({
          recordKind: result.recordKind,
          recordId: result.recordId,
          assetId: result.assetId,
          assetName: result.assetName,
          label: result.label,
          snippet: result.snippet,
          value: result.value,
          matchKinds: result.matchKinds,
          trustLevel: result.trustLevel,
          visibilityLabel: result.visibilityLabel,
          ownership: result.ownership,
        })),
      };
    },
  },
  tier: (view) => (view.results.length > 0 ? "disclosure" : "line"),
  summary: (view) => (view.results.length > 0 ? null : "Nothing found on your things"),
  key: (view) =>
    `asset-search:${view.results.map((result) => `${result.recordKind}:${result.recordId}`).join("|")}`,
  render: (view, isNew) => {
    if (view.results.length === 0) {
      return (
        <ToolActivityLine icon={<PackageIcon aria-hidden className="size-3.5" />} isNew={isNew}>
          Nothing found on your things
        </ToolActivityLine>
      );
    }
    const count = view.results.length;
    return (
      <DisclosureShell
        icon={<PackageIcon aria-hidden className="size-3.5 shrink-0" />}
        isNew={isNew}
        summary={count === 1 ? "1 match on your things" : `${count} matches on your things`}
        toolView={view.kind}
      >
        <div className="flex flex-col divide-y divide-border/70 border-t px-3.5 pt-3 pb-3.5">
          {view.results.map((result) => (
            <AssetSearchResultRow key={`${result.recordKind}:${result.recordId}`} result={result} />
          ))}
        </div>
      </DisclosureShell>
    );
  },
});

/** Asset facts Eve proposed for review — routed to the shared grouped Asset review card. */
export const assetReviewGroupModule = defineModule<"asset_review_group">({
  kind: "asset_review_group",
  parsers: {
    propose_asset_memories: (output) => {
      const parsed = assistantToolResultSchemas.propose_asset_memories.safeParse(output);
      if (!parsed.success) return null;
      return { kind: "asset_review_group", review: toAssetReviewGroupChatView(parsed.data) };
    },
  },
  negativeOutcome: {
    matches: (output) => flagIsFalse(output, "found"),
    note: "Nothing to review",
  },
  tier: () => "card",
  key: (view) => `asset-review-group:${view.review.groupId}`,
  interactive: true,
});

/** Snapshot-backed Asset context: reviewed facts lead; a stale summary is never shown. */
export const assetContextModule = defineModule<"asset_context">({
  kind: "asset_context",
  parsers: {
    get_asset_context: (output) => {
      const parsed = assistantToolResultSchemas.get_asset_context.safeParse(output);
      if (!parsed.success) {
        // A `found: false` result carries none of the asset fields, so it fails the
        // schema by design — render it as the empty state rather than a generic line.
        return {
          kind: "asset_context",
          found: false,
          assetName: null,
          snapshotStatus: null,
          summary: null,
          facts: [],
          evidence: [],
          actions: [],
        };
      }
      return {
        kind: "asset_context",
        found: true,
        assetName: parsed.data.assetName,
        snapshotStatus: parsed.data.snapshotStatus,
        // A fallback snapshot is stale or missing: never show cached prose as current.
        summary: parsed.data.snapshotStatus === "fallback" ? null : parsed.data.summary,
        facts: parsed.data.facts,
        evidence: parsed.data.evidence,
        actions: parsed.data.actions,
      };
    },
  },
  tier: (view) => (view.found ? "card" : "line"),
  summary: (view) => (view.found ? null : "No such asset"),
  key: (view) => `asset-context:${view.assetName ?? "unknown"}`,
  render: (view, isNew) =>
    view.found ? (
      <AssetContextCard isNew={isNew} view={view} />
    ) : (
      <ToolActivityLine icon={<PackageIcon aria-hidden className="size-3.5" />} isNew={isNew}>
        No such asset
      </ToolActivityLine>
    ),
});
