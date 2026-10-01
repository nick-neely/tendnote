import {
  EVE_TOOL_NAMES,
  type EveMode,
  type EveSkillName,
  type EveToolName,
  modeAllowsTool,
} from "./eve-modes";

/**
 * Progressive tool disclosure (ADR-0227): which tool schemas an interactive turn
 * ships.
 *
 * A **Tool Family** is a group of tools whose schemas stay off the interactive
 * surface until the skill that documents them is loaded. Loading a skill is what
 * discloses its family, so a turn that follows the base instructions ("load the
 * matching skill before you act") pays no extra round trip, and a turn that
 * reaches for a family tool first gets told which skill to load.
 *
 * Every authored tool belongs to at least one family, and a tool several skills
 * document belongs to each of their families, so loading any one of them
 * discloses it. What ships before any skill loads is the **router surface**: the
 * framework's own tools (`load_skill` among them) and, for each authored tool, a
 * schema-less stub naming the skills that disclose it.
 *
 * ## This is cost, never authority
 *
 * Disclosure decides only whether a schema ships. It never makes a tool
 * reachable: withholding binds the name to an inert definition, and disclosing
 * simply stops doing that, which leaves the name to whatever the mode gate
 * decided. So a tool the mode forbids stays forbidden whether or not its family
 * was disclosed, and disclosure only ever withholds tools the mode allows, which
 * keeps its names disjoint from the gate's.
 *
 * ## Why disclosure is read from history
 *
 * The families disclosed are exactly the skills whose `load_skill` call is in
 * the conversation. There is nothing separate to persist or keep in sync: a
 * resumed conversation discloses what it loaded, and a compaction that drops the
 * skill's instructions drops its schemas with them, so the two cannot disagree.
 */

/**
 * Tools the base instructions document for every request and no skill does:
 * the follow-up chips that end a substantive answer, and the bounded web fetch.
 * Every family discloses them, so any loaded skill makes them available.
 */
const DISCLOSED_BY_EVERY_FAMILY = [
  "suggest_next_steps",
  "web_fetch",
] as const satisfies readonly EveToolName[];

/**
 * The Tool Families, keyed by the skill that discloses them. Each holds exactly
 * the authored tools its skill documents; `tests/eve-tool-disclosure.test.ts`
 * pins that against the skill files, so editing a skill's tools means editing
 * its row here.
 */
const TOOL_FAMILIES = {
  actions: [
    "accept_suggested_general_action",
    "create_general_action",
    "dismiss_suggested_general_action",
    "edit_general_action",
    "get_asset_context",
    "get_person_context",
    "get_suggested_general_action_review",
    "list_due_followups",
    "list_general_action_areas",
    "list_general_actions",
    "list_saved_items",
    "list_suggested_general_action_reviews",
    "plan_suggested_general_actions",
    "propose_asset_actions",
    "search_assets",
    "search_people",
    "search_relationship_context",
    "search_semantic_context",
    "suggest_general_action",
    "update_general_action_status",
  ],
  "capturing-and-review": [
    "approve_suggested_memory",
    "archive_memory",
    "capture_memory",
    "capture_saved_item",
    "capture_source_record",
    "change_saved_item_capture",
    "cleanup_preview",
    "create_person",
    "dismiss_suggested_memory",
    "get_person_context",
    "get_suggested_memory_review",
    "list_suggested_memory_reviews",
    "propose_suggested_memory",
    "search_people",
    "undo_person_update",
    "undo_saved_item_capture",
    "update_person",
  ],
  drafting: [
    "create_message_draft",
    "dismiss_draft",
    "edit_draft_body",
    "list_message_drafts",
    "save_draft_to_gmail",
    "search_people",
  ],
  followups: [
    "accept_suggested_followup",
    "create_followup",
    "dismiss_suggested_followup",
    "get_relationship_agenda",
    "get_suggested_followup_review",
    "list_due_followups",
    "list_suggested_followup_reviews",
    "propose_followup",
    "search_people",
    "update_followup_status",
  ],
  "household-and-gifts": [
    "add_gift_idea",
    "edit_gift_idea",
    "get_gift_plan",
    "household_check_in",
    "remove_gift_idea",
    "search_gift_plans",
  ],
  recall: [
    "read_attachment",
    "capture_saved_item",
    "create_asset",
    "create_general_action",
    "edit_asset",
    "get_asset_context",
    "get_person_context",
    "get_relationship_agenda",
    "list_calendar_events",
    "list_saved_items",
    "propose_asset_actions",
    "propose_asset_memories",
    "search_assets",
    "search_global_recall",
    "search_people",
    "search_relationship_context",
    "search_semantic_context",
  ],
  "self-context": [
    "archive_self_context",
    "capture_saved_item",
    "get_self_context_fact",
    "list_self_context",
    "remember_self_context",
    "restore_self_context",
    "update_self_context",
  ],
} as const satisfies Record<EveSkillName, readonly EveToolName[]>;

export type ToolFamily = keyof typeof TOOL_FAMILIES;

export const TOOL_FAMILY_NAMES = Object.keys(TOOL_FAMILIES) as readonly ToolFamily[];

export function toolFamilyMembers(family: ToolFamily): readonly EveToolName[] {
  return [...TOOL_FAMILIES[family], ...DISCLOSED_BY_EVERY_FAMILY];
}

function isToolFamily(value: unknown): value is ToolFamily {
  return typeof value === "string" && Object.hasOwn(TOOL_FAMILIES, value);
}

/** The family a `load_skill` call on this message part discloses, if any. */
function disclosedFamily(part: unknown): ToolFamily | null {
  if (typeof part !== "object" || part === null) return null;
  const { type, toolName, input } = part as { type?: unknown; toolName?: unknown; input?: unknown };
  if (type !== "tool-call" || toolName !== "load_skill") return null;
  if (typeof input !== "object" || input === null) return null;
  const { skill } = input as { skill?: unknown };
  return isToolFamily(skill) ? skill : null;
}

/**
 * The families a conversation has disclosed: every family whose skill an
 * assistant `load_skill` call named. Total by construction, so any shape it
 * does not understand discloses nothing.
 */
export function disclosedToolFamilies(messages: unknown): ReadonlySet<ToolFamily> {
  const disclosed = new Set<ToolFamily>();
  if (!Array.isArray(messages)) return disclosed;

  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const { role, content } = message as { role?: unknown; content?: unknown };
    if (role !== "assistant" || !Array.isArray(content)) continue;
    for (const part of content) {
      const family = disclosedFamily(part);
      if (family !== null) disclosed.add(family);
    }
  }
  return disclosed;
}

/** One tool whose schema this turn withholds, and the skills any of which discloses it. */
export type UndisclosedTool = {
  readonly tool: EveToolName;
  readonly skills: readonly ToolFamily[];
};

/**
 * The tools whose schemas a step withholds: every tool the mode allows that no
 * disclosed family holds.
 *
 * Only the interactive surface discloses progressively; every other mode is
 * already narrowed to what it runs, so it ships its allowed set as the gate
 * leaves it. Tools the mode forbids are never listed: the gate owns those names.
 */
export function undisclosedTools(
  mode: EveMode,
  disclosed: ReadonlySet<ToolFamily>,
): readonly UndisclosedTool[] {
  if (mode !== "web_chat") return [];

  return EVE_TOOL_NAMES.filter((tool) => modeAllowsTool(mode, tool)).flatMap((tool) => {
    const skills = TOOL_FAMILY_NAMES.filter((family) => toolFamilyMembers(family).includes(tool));
    return skills.some((family) => disclosed.has(family)) ? [] : [{ tool, skills }];
  });
}
