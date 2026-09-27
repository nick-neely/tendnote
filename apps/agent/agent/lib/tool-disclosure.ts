import { type EveMode, type EveSkillName, type EveToolName, modeAllowsTool } from "./eve-modes";

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
 * Every tool outside a family is the **router surface**: offered with its full
 * schema on every turn, as before.
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
 * The first Tool Families, keyed by the skill that discloses them.
 *
 * Each is a domain that is used deliberately rather than on most turns, and each
 * tool here is documented by its skill. Recall, capture, and follow-ups stay on
 * the router surface: they are the product's everyday path.
 */
const TOOL_FAMILIES = {
  actions: [
    "accept_suggested_general_action",
    "create_general_action",
    "dismiss_suggested_general_action",
    "edit_general_action",
    "get_suggested_general_action_review",
    "list_general_action_areas",
    "list_general_actions",
    "list_suggested_general_action_reviews",
    "plan_suggested_general_actions",
    "suggest_general_action",
    "update_general_action_status",
  ],
  drafting: [
    "create_message_draft",
    "dismiss_draft",
    "edit_draft_body",
    "list_message_drafts",
    "save_draft_to_gmail",
  ],
  "household-and-gifts": [
    "add_gift_idea",
    "edit_gift_idea",
    "get_gift_plan",
    "household_check_in",
    "remove_gift_idea",
    "search_gift_plans",
  ],
  "self-context": [
    "archive_self_context",
    "get_self_context_fact",
    "list_self_context",
    "remember_self_context",
    "restore_self_context",
    "update_self_context",
  ],
} as const satisfies Partial<Record<EveSkillName, readonly EveToolName[]>>;

export type ToolFamily = keyof typeof TOOL_FAMILIES;

export const TOOL_FAMILY_NAMES = Object.keys(TOOL_FAMILIES) as readonly ToolFamily[];

export function toolFamilyMembers(family: ToolFamily): readonly EveToolName[] {
  return TOOL_FAMILIES[family];
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

/** One tool whose schema this turn withholds, and the skill that discloses it. */
export type UndisclosedTool = { readonly tool: EveToolName; readonly family: ToolFamily };

/**
 * The tools whose schemas a step withholds.
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

  return TOOL_FAMILY_NAMES.filter((family) => !disclosed.has(family)).flatMap((family) =>
    TOOL_FAMILIES[family]
      .filter((tool) => modeAllowsTool(mode, tool))
      .map((tool) => ({ tool, family })),
  );
}
