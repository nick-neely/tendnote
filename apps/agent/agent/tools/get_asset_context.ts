import { getAssetSnapshot } from "@tendnote/db/queries/asset-snapshots";
import { describeAssetMemoryValue, visibilityLabelForScope } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

export default defineTool({
  description:
    "Loads everything the caller may see about one known Asset: its reviewed Asset Memories (the confirmed facts), the Asset Evidence on file, related assets, and the linked General Actions — plus a generated Asset Snapshot summary. Use this after `search_assets` has identified the asset and the user wants its full picture ('tell me about the fridge', 'what do I know about the car?'). The `summary` is a GENERATED CACHE, not a source of truth: never quote a model number, serial, filter size, price, or date from it — take every specific fact from `facts`, which are the real records. When `snapshotStatus` is `fallback` the summary is missing or stale; answer from `facts` alone and do not mention the cache. Evidence is grounding material: say a receipt or manual is on file, never assert what it says. Records the caller cannot see are simply absent — never imply that hidden context exists. Do not use this to search across assets (`search_assets`), for people (`get_person_context`), or to write anything.",
  inputSchema: z.object({
    // A uuid, not a name — the shape the store actually holds. A free-form string let a
    // guessed asset *name* through to a uuid column, where the driver refused it and the
    // raw failed query came back as the tool result. The seam denies a malformed id
    // deterministically now; the schema stops the call one layer earlier, and says why.
    assetId: z
      .uuid()
      .describe(
        "The Asset's id, copied exactly from a prior `search_assets` result. Never a " +
          "name, and never guessed — search first if you do not have one.",
      ),
  }),
  async execute(input, ctx) {
    const callerUserId = resolveOwnerUserId(ctx);
    const { status, snapshot, context } = await withModelSafeStoreErrors(() =>
      getAssetSnapshot({ callerUserId, assetId: input.assetId }),
    );

    if (!context.asset) {
      // Deterministic denial: an asset the caller cannot see, one that does not exist,
      // and one whose id could never exist are indistinguishable (ADR 0153).
      return {
        found: false as const,
        component: { type: "asset_context", found: false },
      };
    }

    const { asset } = context;

    return {
      found: true as const,
      assetId: asset.id,
      assetName: asset.name,
      assetKind: asset.kind,
      assetStatus: asset.status,
      visibilityLabel: visibilityLabelForScope(asset.scope),
      // The anchor's ownership form, carried so every surface reading this result
      // can suppress an audience nobody chose on the household's own record
      // (ADR 0214). Reported once, on the Asset, and reused for its facts below —
      // a memory under a household-native Asset is the household's too.
      ownership: asset.ownership,
      snapshotStatus: status,
      // Generated prose. Deliberately a separate field from `facts` so it can never be
      // mistaken for the records — and null when there is no usable snapshot at all.
      summary: snapshot?.summary ?? null,
      facts: context.memories.map((memory) => ({
        memoryId: memory.id,
        label: memory.label,
        value: describeAssetMemoryValue(memory.value) || null,
        notes: memory.notes,
        visibilityLabel: visibilityLabelForScope(memory.scope),
        ownership: asset.ownership,
      })),
      evidence: context.evidence.map((item) => ({
        evidenceId: item.id,
        kind: item.kind,
        label: item.label,
      })),
      relatedAssets: context.relatedAssets.map((related) => ({
        assetId: related.assetId,
        relation: related.relation,
        name: related.assetName,
      })),
      actions: context.actions.map((action) => ({
        actionId: action.id,
        title: action.title,
        status: action.status,
        dueAt: action.dueAt,
      })),
      component: {
        type: "asset_context",
        found: true,
        assetName: asset.name,
        factCount: context.memories.length,
      },
    };
  },
  toModelOutput(output) {
    if (!output.found) {
      return { type: "json", value: { found: false } };
    }

    return {
      type: "json",
      value: {
        asset: output.assetName,
        kind: output.assetKind,
        status: output.assetStatus,
        // Nothing to state an audience from when the household owns the record.
        visibility: output.ownership === "household_native" ? null : output.visibilityLabel,
        ownership: output.ownership,
        // The trust boundary, restated where the model actually reads it: the summary
        // is a cache, the facts are the records.
        snapshot:
          output.snapshotStatus === "fallback"
            ? { available: false, guidance: "No usable summary. Answer from `facts` only." }
            : {
                available: true,
                summary: output.summary,
                guidance:
                  "Generated cache, not source of truth. Never take an exact value " +
                  "(model, serial, filter size, price, date) from it — use `facts`.",
              },
        facts: output.facts.map((fact) => ({
          label: fact.label,
          value: fact.value,
          notes: fact.notes,
          visibility: fact.ownership === "household_native" ? null : fact.visibilityLabel,
        })),
        evidenceOnFile: output.evidence.map((item) => `${item.label} (${item.kind})`),
        relatedAssets: output.relatedAssets.map(
          (related) => `${related.relation.replace(/_/g, " ")} ${related.name}`,
        ),
        actions: output.actions.map((action) => ({
          title: action.title,
          status: action.status,
          dueAt: action.dueAt,
        })),
        rendered: "The asset and its details are shown to the user in a card.",
        guidance:
          "Don't relist the facts, evidence, or actions — the card shows them. Answer what was asked in a line or two; an exact stored value may be quoted when it is the answer.",
      },
    };
  },
});
