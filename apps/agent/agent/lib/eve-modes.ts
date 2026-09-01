/**
 * Eve modes (ADR-0128): which tools and skills a session may actually use.
 *
 * A mode only ever *restricts*. The registry below is the single table; the
 * dynamic tool gate at `agent/tools/eve_mode_gate.ts` is what makes it bite,
 * including for provider-managed framework capabilities that have no authored
 * executor.
 *
 * ## Only trusted signals select a mode
 *
 * A mode is resolved from the session principal the channel's own `AuthFn`
 * stamped (`lib/eve-auth.ts` for the web channel, Eve's app principal for
 * anything the runtime starts). It is never resolved from message text, from
 * `clientContext`, or from anything else the model or the browser can author:
 * a mode that a caller can select is not a boundary, it is a suggestion.
 *
 * ## Tools are enforced; skills are documentation
 *
 * The gate withholds tools. The per-mode `skills` list says which guidance
 * belongs to a mode and is not enforced, deliberately: a skill only loads when
 * the model calls `load_skill`, it authorizes nothing on its own, and its
 * instructions are inert once the tools they describe are withheld. eve 0.32
 * would let a dynamic skill *override* an authored one rather than remove it,
 * so narrowing here would mean replacing a skill's body with a note saying it
 * does not apply: prompt noise for no authority gained.
 *
 * ## The three ADR modes that are context, not authority
 *
 * ADR-0128 also named Selected Person, Drafting, and Cleanup Preview modes.
 * All three are *intent expressed inside a conversation* - the person page the
 * browser says is open, a request to draft something, a block of pasted text to
 * parse. The only signal for any of them arrives in the turn's own content,
 * which is exactly the input a mode must not trust. They are kept here as named
 * context, with no tool surface of their own, and the narrowing they were meant
 * to provide lives where it can be enforced instead: `cleanup_preview` writes
 * nothing by construction, drafts are review-gated in the query layer, and the
 * selected person is framed as untrusted data
 * (`apps/web/src/lib/eve/selected-person-context.ts`).
 */

/**
 * Every tool authored under `agent/tools/`, excluding the files that author no
 * tool of their own: the `disableTool()` sentinels and the gate's own dynamic
 * resolver. `tests/eve-modes.test.ts` pins this against the directory, so a new
 * tool cannot arrive without being given a place in the table below.
 */
export const EVE_TOOL_NAMES = [
  "accept_suggested_followup",
  "accept_suggested_general_action",
  "add_gift_idea",
  "approve_suggested_memory",
  "archive_memory",
  "archive_self_context",
  "capture_memory",
  "capture_saved_item",
  "capture_source_record",
  "change_saved_item_capture",
  "cleanup_preview",
  "create_asset",
  "create_followup",
  "create_general_action",
  "create_message_draft",
  "create_person",
  "dismiss_draft",
  "dismiss_suggested_followup",
  "dismiss_suggested_general_action",
  "dismiss_suggested_memory",
  "edit_asset",
  "edit_draft_body",
  "edit_general_action",
  "edit_gift_idea",
  "get_asset_context",
  "get_gift_plan",
  "get_person_context",
  "get_relationship_agenda",
  "get_self_context_fact",
  "get_suggested_followup_review",
  "get_suggested_general_action_review",
  "get_suggested_memory_review",
  "household_check_in",
  "list_calendar_events",
  "list_due_followups",
  "list_general_action_areas",
  "list_general_actions",
  "list_message_drafts",
  "list_saved_items",
  "list_self_context",
  "list_suggested_followup_reviews",
  "list_suggested_general_action_reviews",
  "list_suggested_memory_reviews",
  "plan_suggested_general_actions",
  "propose_asset_actions",
  "propose_asset_memories",
  "propose_followup",
  "propose_suggested_memory",
  "remember_self_context",
  "remove_gift_idea",
  "restore_self_context",
  "save_draft_to_gmail",
  "search_assets",
  "search_gift_plans",
  "search_global_recall",
  "search_people",
  "search_relationship_context",
  "search_semantic_context",
  "suggest_general_action",
  "undo_saved_item_capture",
  "update_followup_status",
  "update_general_action_status",
  "update_person",
  "update_self_context",
  "web_fetch",
] as const;

export type EveToolName = (typeof EVE_TOOL_NAMES)[number];

/**
 * Framework-owned capabilities that the mode gate must shadow when a session
 * cannot use them. `web_search` is provider-executed and therefore has no
 * authored `agent/tools/web_search.ts` definition to appear in EVE_TOOL_NAMES.
 * A same-name dynamic definition is the only Eve 0.32 mechanism that can keep
 * the provider executor from being injected for a forbidden mode.
 */
export const EVE_FRAMEWORK_TOOL_NAMES = ["web_search"] as const;

export type EveFrameworkToolName = (typeof EVE_FRAMEWORK_TOOL_NAMES)[number];
export type EveGatedToolName = EveToolName | EveFrameworkToolName;

/** Every authored capability plus the framework capability governed by modes. */
export const EVE_GATED_TOOL_NAMES = [
  ...EVE_TOOL_NAMES,
  ...EVE_FRAMEWORK_TOOL_NAMES,
] as const satisfies readonly EveGatedToolName[];

/** Every skill authored under `agent/skills/`, by slug. Pinned the same way. */
export const EVE_SKILL_NAMES = [
  "actions",
  "capturing-and-review",
  "drafting",
  "followups",
  "household-and-gifts",
  "recall",
  "self-context",
] as const;

export type EveSkillName = (typeof EVE_SKILL_NAMES)[number];

/**
 * The modes a trusted signal can actually select.
 *
 * `restricted` is the default: a session whose origin this file does not
 * recognise gets no tools at all rather than the curated surface. It is as
 * fail-closed as the framework permits rather than unconditionally so - eve
 * 0.32 skips a dynamic resolver that throws and runs the turn on the static
 * compiled set, so a gate that crashed would hand back the full authored
 * surface. `agent/tools/eve_mode_gate.ts` therefore resolves inside a catch and
 * falls back to this mode rather than letting anything escape.
 */
export type EveMode = "web_chat" | "discord_capture" | "scheduled_workflow" | "restricted";

/**
 * ADR-0128 modes that survive as conversation context only. They narrow no
 * tools because no trusted signal selects them; see the file header.
 */
export const EVE_CONTEXT_MODES = ["selected_person", "drafting", "cleanup_preview"] as const;

export type EveModeDefinition = {
  readonly mode: EveMode;
  readonly tools: readonly EveGatedToolName[];
  readonly skills: readonly EveSkillName[];
};

/**
 * Reads a scheduled workflow may perform. Every one is owner-scoped and
 * returns records; none writes, drafts, sends, or needs the user present.
 */
const SCHEDULED_WORKFLOW_READS = [
  "get_asset_context",
  "get_gift_plan",
  "get_person_context",
  "get_relationship_agenda",
  "get_self_context_fact",
  "get_suggested_followup_review",
  "get_suggested_general_action_review",
  "get_suggested_memory_review",
  "list_calendar_events",
  "list_due_followups",
  "list_general_action_areas",
  "list_general_actions",
  "list_message_drafts",
  "list_saved_items",
  "list_self_context",
  "list_suggested_followup_reviews",
  "list_suggested_general_action_reviews",
  "list_suggested_memory_reviews",
  "search_assets",
  "search_gift_plans",
  "search_global_recall",
  "search_people",
  "search_relationship_context",
  "search_semantic_context",
] as const satisfies readonly EveToolName[];

/**
 * Writes a scheduled workflow may perform: review-gated proposals only. A
 * workflow runs with nobody watching, so everything it produces has to land in
 * a review queue the owner still has to accept.
 */
const SCHEDULED_WORKFLOW_PROPOSALS = [
  "plan_suggested_general_actions",
  "propose_asset_actions",
  // `propose_asset_memories` belongs here by shape and cannot be here in fact:
  // it also writes a durable grounding Source Record, so it carries an
  // unconditional owner approval that denies outside `web_chat` (ADR-0237).
  "propose_followup",
  "propose_suggested_memory",
  "suggest_general_action",
] as const satisfies readonly EveToolName[];

/**
 * The mode table.
 *
 * Each entry is an allowlist: a tool absent from it is unavailable in that
 * mode, so a tool added to `agent/tools/` joins the curated web surface and
 * nothing else until someone decides otherwise.
 */
const modeDefinitions = {
  // Selected by: a signed-in owner on the web channel (`attributes.channel`
  // is `"eve"`). The curated surface is the whole authored tool set plus the
  // provider-managed web search capability, which is what the web assistant is
  // for; narrowing happens below, never here.
  web_chat: {
    mode: "web_chat",
    tools: EVE_GATED_TOOL_NAMES,
    skills: EVE_SKILL_NAMES,
  },
  // Selected by: a session stamped with the Discord channel by that channel's
  // own auth. ADR-0140 makes Discord a capture surface and nothing else, and
  // today its route is a deterministic handler that writes one Source Record
  // for review without starting a model session at all
  // (`lib/discord-capture.ts`) - so no tool here is ever reached. It used to
  // name `capture_source_record`, which now carries an unconditional owner
  // approval that denies outside `web_chat` (ADR-0237): advertising a tool this
  // surface could only ever be refused is a lie the table should not tell. If a
  // Discord model session is ever introduced, the answer is a channel that can
  // render and answer an approval, not an entry here.
  discord_capture: {
    mode: "discord_capture",
    tools: [],
    skills: ["capturing-and-review"],
  },
  // Selected by: Eve's own app principal (`principalType` is `"runtime"`),
  // which is what a schedule-started session runs as. Reads plus review-gated
  // proposals: no durable-truth writes, no drafting, no external side effects,
  // and nothing that needs a human in the loop - `household_check_in` asks the
  // owner a question and `cleanup_preview` needs text the owner pasted, so
  // neither belongs to an unattended run.
  scheduled_workflow: {
    mode: "scheduled_workflow",
    tools: [...SCHEDULED_WORKFLOW_READS, ...SCHEDULED_WORKFLOW_PROPOSALS],
    skills: ["actions", "followups", "recall"],
  },
  // Selected by: anything else, including a session with no principal at all.
  restricted: {
    mode: "restricted",
    tools: [],
    skills: [],
  },
} as const satisfies Record<EveMode, EveModeDefinition>;

/**
 * The part of a session principal a mode is allowed to read: what the channel's
 * `AuthFn` stamped, and nothing the caller supplied.
 */
export type EveSessionPrincipal = {
  readonly principalType: string;
  readonly attributes?: Readonly<Record<string, string | readonly string[]>>;
};

/**
 * The `attributes.channel` marker each channel's auth stamps, mapped to the
 * mode it selects. `lib/eve-auth.ts` is the only place that stamps `"eve"`.
 */
const MODE_BY_CHANNEL_ATTRIBUTE: Readonly<Record<string, EveMode>> = {
  discord: "discord_capture",
  eve: "web_chat",
};

/**
 * Resolve the mode for a session from its authenticated principal.
 *
 * Pass `ctx.session.auth.current`: the caller of the *active turn*, so a
 * session cannot be opened by one principal and continued under another's
 * authority. Unknown shapes fall through to `restricted`.
 */
export function resolveSessionEveMode(principal: EveSessionPrincipal | null | undefined): EveMode {
  if (!principal) return "restricted";

  // Eve's own app principal: schedules and anything else the runtime starts.
  if (principal.principalType === "runtime") return "scheduled_workflow";

  if (principal.principalType !== "user") return "restricted";

  const channel = principal.attributes?.channel;
  if (typeof channel !== "string") return "restricted";

  return MODE_BY_CHANNEL_ATTRIBUTE[channel] ?? "restricted";
}

export function eveModeDefinition(mode: EveMode): EveModeDefinition {
  return modeDefinitions[mode];
}

export function modeAllowsTool(mode: EveMode, tool: EveGatedToolName): boolean {
  return (modeDefinitions[mode].tools as readonly EveGatedToolName[]).includes(tool);
}

export function modeAllowsSkill(mode: EveMode, skill: EveSkillName): boolean {
  return (modeDefinitions[mode].skills as readonly EveSkillName[]).includes(skill);
}

/** The authored and gated framework tools a mode withholds, in registry order. */
export function toolsUnavailableInMode(mode: EveMode): readonly EveGatedToolName[] {
  return EVE_GATED_TOOL_NAMES.filter((tool) => !modeAllowsTool(mode, tool));
}

export function listEveModeDefinitions(): readonly EveModeDefinition[] {
  return Object.values(modeDefinitions);
}
