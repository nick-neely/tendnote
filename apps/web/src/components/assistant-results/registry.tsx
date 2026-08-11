import type { RenderedToolName } from "@tendnote/domain";
import { TriangleAlertIcon } from "@/components/icons";
import { humanizeToolName } from "@/lib/eve/tool-name";
import type { AssistantToolView, ToolViewTier } from "@/lib/eve/tool-result-view";
import { assetContextModule, assetReviewGroupModule, assetSearchModule } from "./asset";
import {
  draftProposalModule,
  messageDraftModule,
  suggestedFollowupReviewListModule,
  suggestedFollowupReviewModule,
} from "./follow-up-draft";
import {
  createdGeneralActionModule,
  generalActionListModule,
  suggestedGeneralActionReviewListModule,
  suggestedGeneralActionReviewModule,
} from "./general-action";
import {
  captureOutcomeModule,
  giftIdeaAddedModule,
  giftPlanSearchModule,
  householdCheckinModule,
} from "./household";
import { defineModule, type ResultModule } from "./module";
import {
  addedPersonModule,
  memoryCuratorProposalsModule,
  personContextModule,
  relationshipAgendaModule,
  relationshipContextSearchModule,
  savedMemoryModule,
  savedSourceRecordModule,
  semanticContextSearchModule,
  suggestedMemoryReviewListModule,
  suggestedMemoryReviewModule,
  updatedPersonModule,
} from "./relationship-memory";
import { ToolActivityLine } from "./shells";

/**
 * The single, exhaustive registry of deep result modules. Every fixed typed
 * Assistant Surface result kind travels through exactly one module here, from
 * persisted output ({@link toAssistantToolView}) to rendered behavior. The
 * dispatchers below are thin, exhaustive table lookups — they hold no per-kind
 * trust, projection, or rendering policy; that all lives in the modules.
 */

/**
 * The safe fallback, in three honest, visually distinct presentations:
 *
 * - `malformed` — a known tool's schema-invalid, possibly-failed result: the clay
 *   tentative tone and a warning mark, so it never passes for routine housekeeping;
 * - `note` — a known tool's well-formed *negative* outcome (nothing found, nothing
 *   created): a quiet neutral line in plain honest copy, never dressed up as an error;
 * - neither — a benign unrecognized tool that ran to completion: a quiet line naming it.
 */
const genericModule = defineModule<"generic">({
  kind: "generic",
  parsers: {},
  tier: () => "line",
  key: (view) => {
    if (view.malformed) return `tool-malformed:${view.toolName}`;
    if (view.note) return `tool-empty:${view.toolName}`;
    return `tool:${view.toolName}`;
  },
  render: (view, isNew) => {
    if (view.malformed) {
      return (
        <ToolActivityLine
          icon={<TriangleAlertIcon aria-hidden className="size-3.5 text-accent" />}
          isNew={isNew}
        >
          <span className="text-accent">
            {humanizeToolName(view.toolName)} didn't return a readable result
          </span>
        </ToolActivityLine>
      );
    }
    return (
      <ToolActivityLine
        icon={<span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/50" />}
        isNew={isNew}
      >
        {view.note ?? humanizeToolName(view.toolName)}
      </ToolActivityLine>
    );
  },
});

/**
 * Every module keyed by the `AssistantToolView` kind it owns. The `satisfies`
 * makes this exhaustive at compile time: a new kind on the union that has no module
 * here is a type error, and each entry is checked against its own kind's view.
 */
export const RESULT_MODULES = {
  saved_source_record: savedSourceRecordModule,
  saved_memory: savedMemoryModule,
  added_person: addedPersonModule,
  updated_person: updatedPersonModule,
  person_context: personContextModule,
  suggested_memory_review: suggestedMemoryReviewModule,
  suggested_memory_review_list: suggestedMemoryReviewListModule,
  relationship_context_search: relationshipContextSearchModule,
  semantic_context_search: semanticContextSearchModule,
  relationship_agenda: relationshipAgendaModule,
  memory_curator_proposals: memoryCuratorProposalsModule,
  suggested_followup_review: suggestedFollowupReviewModule,
  suggested_followup_review_list: suggestedFollowupReviewListModule,
  message_draft: messageDraftModule,
  draft_proposal: draftProposalModule,
  created_general_action: createdGeneralActionModule,
  suggested_general_action_review: suggestedGeneralActionReviewModule,
  suggested_general_action_review_list: suggestedGeneralActionReviewListModule,
  general_action_list: generalActionListModule,
  asset_search: assetSearchModule,
  asset_review_group: assetReviewGroupModule,
  asset_context: assetContextModule,
  household_check_in: householdCheckinModule,
  gift_plan_search: giftPlanSearchModule,
  gift_idea_added: giftIdeaAddedModule,
  capture_outcome: captureOutcomeModule,
  generic: genericModule,
} satisfies { [K in AssistantToolView["kind"]]: ResultModule<K> };

/** Every registered result kind, for exhaustiveness and completeness tests. */
export const ALL_RESULT_KINDS = Object.keys(RESULT_MODULES) as AssistantToolView["kind"][];

// ---------------------------------------------------------------------------
// Parse dispatch (tool output → view)
// ---------------------------------------------------------------------------

/** One Eve tool result surfaced during a turn (a persisted tool's output). */
export type EveToolResult = {
  readonly toolName: string;
  readonly output: unknown;
};

/**
 * The persisted-output → view projectors, keyed by the tool that produced the
 * output and assembled from every module's `parsers`. A tool appears in exactly one
 * module, so this table is a flat inverse of the registry.
 */
const TOOL_PROJECTORS: Partial<
  Record<RenderedToolName, (output: unknown) => AssistantToolView | null>
> = {};
for (const module of Object.values(RESULT_MODULES)) {
  for (const [toolName, parser] of Object.entries(module.parsers)) {
    TOOL_PROJECTORS[toolName as RenderedToolName] = parser as (
      output: unknown,
    ) => AssistantToolView | null;
  }
}

/** The tool → projector table, exposed for completeness tests (read-only). */
export const toolProjectors: Readonly<
  Partial<Record<RenderedToolName, (output: unknown) => AssistantToolView | null>>
> = TOOL_PROJECTORS;

/**
 * The tool → recognized-negative-outcome table. A tool inherits its module's
 * `negativeOutcome`, so every tool a module owns shares the honest negative copy.
 */
const TOOL_NEGATIVE: Partial<
  Record<RenderedToolName, { matches: (output: unknown) => boolean; note: string }>
> = {};
for (const module of Object.values(RESULT_MODULES)) {
  if (!module.negativeOutcome) continue;
  for (const toolName of Object.keys(module.parsers)) {
    TOOL_NEGATIVE[toolName as RenderedToolName] = module.negativeOutcome;
  }
}

/**
 * Maps one persisted Eve tool result into a renderable view, keyed on the tool that
 * produced it. Parsing is total, and the three fallback outcomes stay distinct so the
 * UI never invents a confirmed fact, never disguises a failed save as routine, and
 * never dresses an honest negative up as an error:
 *
 * - an unknown tool (no projector) → a benign `generic` housekeeping line;
 * - a known tool's well-formed negative outcome (projector returned `null`, but the
 *   payload is a recognized `found:false`/`created:false`/`updated:false`) → a neutral
 *   `generic` with honest `note` copy;
 * - a known tool's schema-invalid payload (projector returned `null`, no recognized
 *   negative) → `generic` with `malformed: true`, shown as visibly degraded.
 */
export function toAssistantToolView(toolResult: EveToolResult): AssistantToolView {
  const { toolName, output } = toolResult;
  const tool = toolName as RenderedToolName;
  const projector = TOOL_PROJECTORS[tool];
  if (!projector) {
    return { kind: "generic", toolName };
  }
  const view = projector(output);
  if (view) {
    return view;
  }
  const negative = TOOL_NEGATIVE[tool];
  if (negative?.matches(output)) {
    return { kind: "generic", toolName, note: negative.note };
  }
  return { kind: "generic", toolName, malformed: true };
}

// ---------------------------------------------------------------------------
// View dispatch (tier, identity, rendering)
// ---------------------------------------------------------------------------

/**
 * Visual weight a rendered result earns. Delegates to the owning module: ambient
 * lookups recede to a `line`, durable trust-bearing state keeps a `card`, and a
 * non-empty result set collapses behind a `disclosure`.
 */
export function toolViewTier(view: AssistantToolView): ToolViewTier {
  const tier = RESULT_MODULES[view.kind].tier as (view: AssistantToolView) => ToolViewTier;
  return tier(view);
}

/**
 * Refresh-stable React key for a rendered view, derived by the owning module from
 * the persisted record it references (so a list keys on real ids, not position).
 */
export function assistantToolViewKey(view: AssistantToolView): string {
  const key = RESULT_MODULES[view.kind].key as (view: AssistantToolView) => string;
  return key(view);
}

/**
 * Renders one persisted Eve tool result at its module's presentational tier
 * (line / card / disclosure). Interactive-only kinds have no presentational render
 * — their client card at the turn-unit seam owns them — so this returns nothing for
 * them, and the panel routes them to the interactive card instead.
 */
export function renderResultModule(view: AssistantToolView, isNew: boolean): React.ReactNode {
  const render = RESULT_MODULES[view.kind].render as
    | ((view: AssistantToolView, isNew: boolean) => React.ReactNode)
    | undefined;
  return render ? render(view, isNew) : null;
}

// ---------------------------------------------------------------------------
// Grouping (durable same-kind saves fold into one collapsed group)
// ---------------------------------------------------------------------------

/**
 * Durable, trust-bearing record kinds that fold into a collapsed group when a turn
 * produces several of them. These are the saves the user already confirmed by
 * acting; grouping quiets the transcript without hiding the interactive review
 * cards, which stay individual and actionable. Every kind here has `groupable: true`
 * on its module (asserted by the registry completeness test).
 */
export const GROUPABLE_KINDS = [
  "saved_memory",
  "saved_source_record",
  "added_person",
  "updated_person",
] as const;

export type GroupableToolKind = (typeof GROUPABLE_KINDS)[number];

/** One durable view of a groupable kind, narrowed for the group renderer. */
export type GroupableToolView = Extract<AssistantToolView, { kind: GroupableToolKind }>;

const GROUPABLE_KIND_SET = new Set<AssistantToolView["kind"]>(GROUPABLE_KINDS);

export function isGroupableToolKind(kind: AssistantToolView["kind"]): kind is GroupableToolKind {
  return GROUPABLE_KIND_SET.has(kind);
}

// ---------------------------------------------------------------------------
// Actionability (kinds routed to an interactive client card)
// ---------------------------------------------------------------------------

/**
 * The result kinds that carry an inline action affordance and are rendered by a
 * client card at the {@link AssistantTurnUnitView} seam (the cards import
 * `server-only` review mutations, so they cannot live in this presentational module
 * graph).
 *
 * This tuple is the single source for the set: the {@link InteractiveResultKind}
 * union derives from it, so the turn-unit's renderer table is a *non-optional* map
 * over exactly these kinds — a missing card is a compile error, not a silent no-op.
 * Each owning module also declares `interactive: true`, and the registry
 * completeness test asserts the module flags and this tuple stay in lock-step.
 */
const INTERACTIVE_KINDS = [
  "saved_source_record",
  "message_draft",
  "suggested_memory_review",
  "suggested_memory_review_list",
  "suggested_followup_review",
  "suggested_followup_review_list",
  "suggested_general_action_review",
  "suggested_general_action_review_list",
  "asset_review_group",
] as const satisfies AssistantToolView["kind"][];

export type InteractiveResultKind = (typeof INTERACTIVE_KINDS)[number];

/** The interactive kinds as a set, for the completeness test and any runtime check. */
export const INTERACTIVE_RESULT_KINDS: ReadonlySet<AssistantToolView["kind"]> = new Set(
  INTERACTIVE_KINDS,
);

export { relationshipAgendaCandidateKey } from "./relationship-memory";
