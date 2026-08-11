import { suggestAsset, suggestAssetMemories } from "@tendnote/db/queries/assets";
import { captureSourceRecord } from "@tendnote/db/queries/source-records";
import {
  AssetValidationError,
  assetKindSchema,
  assetLabelForKind,
  assetMemoryValueSchema,
  describeAssetMemoryValue,
  visibilityLabelForScope,
} from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * How many facts one turn may propose. A user telling Eve about their fridge is
 * describing a thing, not dictating a database: a handful of details is a real
 * conversation, and a wall of twenty is an autonomous extraction pass wearing a
 * proposal's clothes. Capped in the schema so it cannot fan out (cf. #203).
 */
export const MAX_ASSET_MEMORY_PROPOSALS = 6;

const detailSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(120)
    .describe("What the fact IS, in the user's vocabulary: 'Filter model', 'Warranty ends'."),
  value: assetMemoryValueSchema
    .nullish()
    .describe(
      "The exact fact, typed: {type:'text',text:'EDR1RXD1'} for a model/serial/size, " +
        "{type:'date',date:'2027-03-14'} for a purchase/warranty/renewal date, " +
        "{type:'interval',interval:6,unit:'month'} for a cadence, or " +
        "{type:'amount',amount:1299.99} for a price. Copy the user's value CHARACTER FOR " +
        "CHARACTER — never correct, expand, reformat, or guess a part number.",
    ),
  notes: z
    .string()
    .min(1)
    .max(2000)
    .nullish()
    .describe("Freeform context, when the fact needs a sentence rather than a value."),
});

const inputSchema = z.object({
  assetId: z
    .uuid()
    .optional()
    .describe(
      "The Asset these facts belong to, copied exactly from a `search_assets` result. " +
        "Search FIRST: if the user's thing is already tracked, the facts must anchor to " +
        "it. Omit ONLY when the search found nothing — then pass `newAsset` instead.",
    ),
  newAsset: z
    .object({
      name: z
        .string()
        .min(1)
        .max(120)
        .describe("What the user calls it — 'Kitchen refrigerator', not 'Refrigerator (kitchen)'."),
      kind: assetKindSchema.describe("The kind of thing it is."),
    })
    .optional()
    .describe(
      "Propose a NEW Asset to hang these facts on, when `search_assets` found nothing " +
        "to anchor to. The Asset is itself only a suggestion until the user accepts it.",
    ),
  saidByUser: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      "What the user actually said, in their own words — this is captured verbatim as " +
        "the grounding for the proposal and shown on the review card so they can check " +
        "what you heard. Never paraphrase it into a fact you invented.",
    ),
  details: z
    .array(detailSchema)
    .min(1)
    .max(MAX_ASSET_MEMORY_PROPOSALS)
    .describe("The facts to propose, one per detail. Only what the user actually told you."),
});

/**
 * The conversational producer for the review-gated Asset Memory seam (#198) — the
 * tool Eve's instructions have promised since #196 ("Asset writes stay review-gated:
 * propose, do not save") and which, until now, did not exist. Told to do something it
 * had no tool for, the model improvised: it *said* it had logged the filter model, then
 * had no record of it a turn later. A promise with no seam behind it is a lie the model
 * is forced to tell; this is the seam.
 *
 * It cannot save a fact, by construction rather than by instruction. Both entry points
 * it calls (`suggestAsset`, `suggestAssetMemories`) only ever write `suggested` rows
 * into an Asset Review Group — the same group the Review tab already renders, with
 * edit-before-accept, per-detail accept/dismiss, duplicate link-to-existing, and batch
 * accept all inherited from #198. Promotion to a durable Asset Memory is the user's own
 * accept, and there is no code path from here to an active row.
 *
 * **Grounding (ADR 0151).** `suggestAsset`/`suggestAssetMemories` make grounding
 * mandatory: a proposal must come from somewhere. #199 and #201 route around that for
 * their user-intent flows by calling `openSuggestedAssetProposal` with a null source —
 * the promotion of an action hint, and a capture where the user names the thing
 * themselves, are their own provenance. A fact Eve heard in conversation is *not* one of
 * those cases: it has a real source, and the source is the sentence the user typed. So
 * this tool takes the ungrounded path off the table and captures `saidByUser` as a
 * Source Record first, then proposes through the public grounded seam. The review card
 * shows those words back ("From assistant note · captured today · <what you said>"), so
 * the user reviews the fact *against what they actually said* — which is exactly the
 * check that catches a misheard part number, and is worth more than the shortcut.
 */
export default defineTool({
  description: `Propose asset facts for the user to review outside Global Capture — a filter or model number, a serial, a purchase/warranty/renewal date, a maintenance cadence, a price — when they TELL you something about a thing they own ("the filter in my kitchen fridge is EDR1RXD1", "I bought the dishwasher in March 2024", "the car warranty runs out next year"). Do not use this for "Use Capture", "capture this", or a turn with another supported explicit clause even if the word Capture is absent; \`capture_saved_item\` owns that path and creates a review-gated Asset outcome. Otherwise call \`search_assets\` first: pass the \`assetId\` it returned so the facts anchor to the asset they already have, or pass \`newAsset\` when the search found nothing. At most ${MAX_ASSET_MEMORY_PROPOSALS} facts per call, copied from the user's own words — never invented, corrected, or reformatted. This SAVES NOTHING: every fact becomes a review card the user accepts, edits, or dismisses. Say it is waiting for review; NEVER say you logged, saved, recorded, or noted it, and never repeat it back later as a stored fact. Use \`create_general_action\` for a reminder they explicitly asked for, and \`propose_asset_actions\` to turn a dated fact into a proposed reminder.`,
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    // A fact has to hang on something. Refusing here — before anything is written —
    // is the honest failure: the alternative is an "Untitled" husk in the user's
    // review queue that they have to clean up after Eve's own missing search.
    const anchor = input.assetId ?? input.newAsset;
    if (!anchor) {
      throw new AssetValidationError(
        "Name the thing these facts belong to: search first and pass the assetId of the " +
          "asset the user already has, or pass newAsset to propose a new one.",
      );
    }

    // The user's own sentence, captured as the proposal's grounding (see the note
    // above). `sourceType: "agent"` is the honest provenance — the user said it, Eve
    // wrote it down — and it renders on the review card as "assistant note". This is
    // the raw capture, deliberately not `captureLoggedContext`: that path enqueues
    // person-memory and action extraction, which has nothing to do with a fridge filter.
    const { sourceRecord } = await withModelSafeStoreErrors(() =>
      captureSourceRecord({
        ownerUserId,
        retainedContent: input.saidByUser,
        sourceType: "agent",
        metadataJson: { captureSurface: "eve", capturedFor: "asset_memory_proposal" },
      }),
    );

    const memories = input.details.map((detail) => ({
      label: detail.label,
      value: detail.value ?? null,
      notes: detail.notes ?? null,
    }));

    // Anchor to the asset the user named; propose a new (suggested) asset only when
    // there was nothing to anchor to. Scope is left to the seam's private default —
    // widening an asset fact is the user's choice at review, never Eve's here.
    const outcome = await withModelSafeStoreErrors(() =>
      typeof anchor === "string"
        ? suggestAssetMemories({
            ownerUserId,
            assetId: anchor,
            sourceRecordId: sourceRecord.id,
            memories,
            source: "assistant",
          })
        : suggestAsset({
            ownerUserId,
            name: anchor.name,
            kind: anchor.kind,
            sourceRecordId: sourceRecord.id,
            memories,
            source: "assistant",
          }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const result = outcome.result;

    return {
      found: true as const,
      groupId: result.group.id,
      asset: {
        id: result.asset.id,
        name: result.asset.name,
        kind: result.asset.kind,
        kindLabel: assetLabelForKind(result.asset.kind),
        scope: result.asset.scope,
        visibilityLabel: visibilityLabelForScope(result.asset.scope),
        ownership: result.asset.ownership,
        pending: result.assetPending,
      },
      memories: result.memories.map((memory) => ({
        id: memory.id,
        label: memory.label,
        value: memory.value,
        notes: memory.notes,
      })),
      duplicates: result.duplicateCandidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        kindLabel: assetLabelForKind(candidate.kind),
      })),
      source: result.sourceRecord
        ? {
            id: result.sourceRecord.id,
            content: result.sourceRecord.content,
            sourceType: result.sourceRecord.sourceType,
            capturedAt: result.sourceRecord.createdAt.toISOString(),
          }
        : null,
      // The anchor counts as a pending member when it is itself still a proposal —
      // the same arithmetic the Review tab uses, so chat and the queue agree.
      pendingCount: result.memories.length + (result.assetPending ? 1 : 0),
    };
  },
  /**
   * The proposal renders as the real Asset Review Group card, so the model gets the
   * shape of what it proposed and nothing to act on: no ids (there is no follow-up call
   * to make — the *user* resolves this), and an explicit reminder of the one thing the
   * model kept getting wrong. It claimed the fact was saved. It is not saved.
   */
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        proposed: true,
        saved: false,
        asset: output.asset.name,
        assetIsNewProposal: output.asset.pending,
        details: output.memories.map((memory) => ({
          label: memory.label,
          value: describeAssetMemoryValue(memory.value) || null,
          notes: memory.notes,
        })),
        guidance:
          "NOTHING WAS SAVED. These are review cards the user must accept before any of " +
          "it becomes a fact. Say it is waiting for their review (e.g. “I've put that " +
          "up for review”) — never that you logged, saved, recorded, noted, or now " +
          "remember it, and do not restate it as a stored fact in a later turn. The card " +
          "already shows the details; don't reprint them." +
          (output.asset.pending
            ? " This asset is new, so it is proposed too — say you have not seen it before."
            : ""),
      },
    };
  },
});
