import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVE_CONTEXT_MODES,
  EVE_FRAMEWORK_TOOL_NAMES,
  EVE_GATED_TOOL_NAMES,
  EVE_SKILL_NAMES,
  EVE_TOOL_NAMES,
  eveModeDefinition,
  listEveModeDefinitions,
  modeAllowsSkill,
  modeAllowsTool,
  resolveSessionEveMode,
  toolsUnavailableInMode,
} from "../agent/lib/eve-modes";
import { authorsTool } from "./tool-source";

const agentRoot = join(import.meta.dirname, "../agent");

const REGISTRY_DRIFT =
  "agent/lib/eve-modes.ts must list every authored tool. Add the new name to EVE_TOOL_NAMES, then decide deliberately whether Discord Capture and Scheduled Workflow may use it: absent from a mode's allowlist means the mode withholds it.";

/**
 * The tools Eve actually authors. A file under `agent/tools/` is one of three
 * things: a tool, a `disableTool()` sentinel turning off a framework default,
 * or a `defineDynamic` resolver like the mode gate, which emits other tools'
 * names rather than one of its own.
 */
function authoredToolNames(): string[] {
  return readdirSync(join(agentRoot, "tools"))
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => authorsTool(readFileSync(join(agentRoot, "tools", file), "utf8")))
    .map((file) => file.replace(/\.ts$/, ""))
    .sort();
}

function authoredSkillNames(): string[] {
  return readdirSync(join(agentRoot, "skills"))
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.replace(/\.md$/, ""))
    .sort();
}

describe("Eve mode registry", () => {
  it("names every authored tool, and nothing that does not exist", () => {
    // The registry used to omit 30 of the tools it was meant to govern and to
    // name skills that had never existed, which is how a mode table stops
    // meaning anything. This pins it to the directory instead.
    expect([...EVE_TOOL_NAMES].sort(), REGISTRY_DRIFT).toEqual(authoredToolNames());
  });

  it("names every authored skill, and nothing that does not exist", () => {
    expect([...EVE_SKILL_NAMES].sort(), REGISTRY_DRIFT).toEqual(authoredSkillNames());
  });

  it("declares the modes a trusted signal can select", () => {
    expect(listEveModeDefinitions().map((definition) => definition.mode)).toEqual([
      "web_chat",
      "discord_capture",
      "scheduled_workflow",
      "restricted",
    ]);
  });

  it("offers the whole curated surface to the web chat mode", () => {
    expect(EVE_FRAMEWORK_TOOL_NAMES).toEqual(["web_search"]);
    expect(eveModeDefinition("web_chat").tools).toEqual(EVE_GATED_TOOL_NAMES);
    expect(eveModeDefinition("web_chat").skills).toEqual(EVE_SKILL_NAMES);
    expect(toolsUnavailableInMode("web_chat")).toEqual([]);
  });

  it("advertises no tool to Discord Capture Mode, including the capture it is named for", () => {
    // The Discord route is a deterministic handler that never starts a model
    // session, and `capture_source_record` now carries an unconditional owner
    // approval that denies outside `web_chat` (ADR-0237), so the entry it used
    // to hold could only ever have been refused.
    expect(eveModeDefinition("discord_capture").tools, REGISTRY_DRIFT).toEqual([]);
    expect(eveModeDefinition("discord_capture").skills).toEqual(["capturing-and-review"]);

    for (const tool of [
      "capture_source_record",
      "create_message_draft",
      "save_draft_to_gmail",
      "approve_suggested_memory",
    ] as const) {
      expect(modeAllowsTool("discord_capture", tool), tool).toBe(false);
    }
    expect(modeAllowsSkill("discord_capture", "drafting")).toBe(false);
  });

  it("holds Scheduled Workflow Mode to reads and review-gated proposals", () => {
    expect(eveModeDefinition("scheduled_workflow").tools, REGISTRY_DRIFT).toEqual([
      "get_asset_context",
      // Reads one plan the caller is already allowed to see, through the same `view`
      // proof `search_gift_plans` runs, so it belongs to the same modes that one does.
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
      "plan_suggested_general_actions",
      "propose_asset_actions",
      "propose_followup",
      "propose_suggested_memory",
      "suggest_general_action",
    ]);

    // Nothing durable, nothing external, and nothing that needs the owner
    // sitting there: an unattended run proposes, it does not decide.
    for (const tool of [
      "accept_suggested_followup",
      "approve_suggested_memory",
      "capture_memory",
      "capture_saved_item",
      "cleanup_preview",
      "create_general_action",
      "create_message_draft",
      "create_person",
      "household_check_in",
      // Review-gated in what it proposes, durable in the Source Record it
      // grounds them on, so it parks - and a park is a hang where nobody is
      // watching (ADR-0237).
      "propose_asset_memories",
      "save_draft_to_gmail",
      "update_person",
    ] as const) {
      expect(modeAllowsTool("scheduled_workflow", tool), tool).toBe(false);
    }
  });

  it("keeps the three context-only ADR modes out of the enforced set", () => {
    // Selected Person, Drafting, and Cleanup Preview are named by ADR-0128 but
    // are selected only by what a turn contains, so promoting one back into an
    // enforced mode would mean narrowing authority on the model's own say-so.
    expect(EVE_CONTEXT_MODES).toEqual(["selected_person", "drafting", "cleanup_preview"]);
    const enforced: string[] = listEveModeDefinitions().map((definition) => definition.mode);
    for (const contextMode of EVE_CONTEXT_MODES) {
      expect(enforced, contextMode).not.toContain(contextMode);
    }
  });

  it("gives an unrecognised session origin nothing at all", () => {
    expect(eveModeDefinition("restricted").tools).toEqual([]);
    expect(eveModeDefinition("restricted").skills).toEqual([]);
    expect(toolsUnavailableInMode("restricted")).toEqual(EVE_GATED_TOOL_NAMES);
  });
});

describe("Eve mode resolution", () => {
  it("reads the mode from the principal the channel's own auth stamped", () => {
    // `lib/eve-auth.ts` stamps both of these on the web channel.
    expect(
      resolveSessionEveMode({
        principalType: "user",
        attributes: { channel: "eve" },
      }),
    ).toBe("web_chat");

    // Eve's app principal, which is what a schedule-started session runs as.
    expect(resolveSessionEveMode({ principalType: "runtime", attributes: {} })).toBe(
      "scheduled_workflow",
    );

    expect(
      resolveSessionEveMode({ principalType: "user", attributes: { channel: "discord" } }),
    ).toBe("discord_capture");
  });

  it("fails closed on anything it does not recognise", () => {
    expect(resolveSessionEveMode(null)).toBe("restricted");
    expect(resolveSessionEveMode(undefined)).toBe("restricted");
    // A user principal with no channel marker: an unprotected route, or a
    // channel whose auth forgot to stamp one.
    expect(resolveSessionEveMode({ principalType: "user" })).toBe("restricted");
    expect(resolveSessionEveMode({ principalType: "user", attributes: {} })).toBe("restricted");
    expect(
      resolveSessionEveMode({ principalType: "user", attributes: { channel: "whatsapp" } }),
    ).toBe("restricted");
    expect(resolveSessionEveMode({ principalType: "service" })).toBe("restricted");
    // Attributes are `string | readonly string[]`; only a single marker counts.
    expect(resolveSessionEveMode({ principalType: "user", attributes: { channel: ["eve"] } })).toBe(
      "restricted",
    );
  });
});
