import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const agentRoot = join(import.meta.dirname, "../agent");

/**
 * Framework defaults no agent node may have. Eve enables its whole default
 * harness unless a file at the tool's own slug exports `disableTool()`, so every
 * one of these was live while `base.md` promised the user the opposite: the
 * agent asserts it never reads file contents and answers only from returned
 * records, and `bash`, `read_file`, `write_file`, `glob`, `grep`, `web_fetch`,
 * and `web_search` each contradict that in a different direction.
 */
const DISABLED_FRAMEWORK_TOOLS = [
  "bash",
  "glob",
  "grep",
  "read_file",
  "web_fetch",
  "web_search",
  "write_file",
];

/**
 * Plus, at the root only, the built-in self-copy: `agent` spawns the root agent
 * with the root instructions and every root tool, which is every narrowing the
 * four declared subagents exist to impose, undone in one call.
 */
const ROOT_DISABLED_FRAMEWORK_TOOLS = [...DISABLED_FRAMEWORK_TOOLS, "agent"].sort();

/**
 * The framework defaults Tendnote keeps. `ask_question` is the clarification
 * path, `load_skill` is the only way a skill loads at all, and `todo` is
 * in-session scratch state that touches no record.
 */
const KEPT_FRAMEWORK_TOOLS = ["ask_question", "load_skill", "todo"];

/**
 * The framework tool names as the installed eve build defines them, read from
 * eve's own registry rather than copied. An eve upgrade that adds a default tool
 * changes this set, which fails the pinning assertion below and forces the new
 * capability to be disabled or kept deliberately instead of arriving silently.
 */
async function frameworkToolNames(): Promise<string[]> {
  const eveRoot = dirname(createRequire(import.meta.url).resolve("eve/package.json"));
  const registryPath = join(eveRoot, "dist/src/runtime/framework-tools/index.js");
  const registry: { getAllFrameworkToolNames(): Set<string> } = await import(
    pathToFileURL(registryPath).href
  );
  return [...registry.getAllFrameworkToolNames()].sort();
}

/** Whether an `agent/**\/tools/` file turns off a framework default instead of authoring a tool. */
function disablesFrameworkTool(relativePath: string): boolean {
  return /export default disableTool\(\)/.test(readFileSync(join(agentRoot, relativePath), "utf8"));
}

/** The framework tools one agent node turns off, by tool name. */
function disabledFrameworkToolsIn(toolsDir: string): string[] {
  return readdirSync(join(agentRoot, toolsDir))
    .filter((file) => file.endsWith(".ts") && disablesFrameworkTool(join(toolsDir, file)))
    .map((file) => file.replace(/\.ts$/, ""))
    .sort();
}

function listAuthoredFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const rel = relative(agentRoot, path);
    if (entry === "node_modules") return [];
    if (statSync(path).isDirectory()) return listAuthoredFiles(path);
    return [rel];
  });
}

describe("active Eve tree", () => {
  it("adds only the real brief dispatcher schedule, no inactive placeholders", () => {
    const files = listAuthoredFiles(agentRoot);

    // Phase 1F adds exactly one real root schedule: the app-owned brief dispatcher
    // (PRD #65, issue #72, ADR-0066). Phase 3 adds the first real declared
    // subagent, Memory Curator (#149). No inactive placeholders are allowed.
    const scheduleFiles = files.filter((file) => file.startsWith("schedules/"));
    expect(scheduleFiles).toEqual(["schedules/brief-dispatcher.ts"]);
    // Framework-default disables are an absence, not a subagent surface; the
    // lockdown test below owns them.
    const subagentFiles = files.filter(
      (file) => file.startsWith("subagents/") && !disablesFrameworkTool(file),
    );
    expect(subagentFiles).toEqual([
      "subagents/memory_curator/agent.ts",
      "subagents/memory_curator/instructions.md",
      "subagents/memory_curator/tools/propose_memory_cleanup.ts",
      "subagents/message_drafter/agent.ts",
      "subagents/message_drafter/instructions.md",
      "subagents/message_drafter/tools/propose_message_draft.ts",
      "subagents/privacy_guard/agent.ts",
      "subagents/privacy_guard/instructions.md",
      "subagents/relationship_strategist/agent.ts",
      "subagents/relationship_strategist/instructions.md",
      "subagents/relationship_strategist/tools/get_relationship_agenda.ts",
      "subagents/relationship_strategist/tools/list_calendar_events.ts",
      "subagents/relationship_strategist/tools/list_message_drafts.ts",
      "subagents/relationship_strategist/tools/propose_followup.ts",
    ]);

    expect(files.filter((file) => file.startsWith("sandbox/"))).toEqual([]);
    expect(files.some((file) => file.startsWith("connections/"))).toBe(false);
    expect(files.some((file) => /placeholder|stub|future/i.test(file))).toBe(false);
  });

  it("disables the framework defaults on every agent node, root and subagent alike", async () => {
    // Deleting one of these files, or turning it back into a real tool, hands the
    // capability straight back; nothing else in the tree would notice.
    expect(disabledFrameworkToolsIn("tools")).toEqual(ROOT_DISABLED_FRAMEWORK_TOOLS);

    // Eve resolves the default harness per agent node, so a declared subagent
    // carries its own bash and its own web_fetch unless it says otherwise. Their
    // curated toolsets are only as narrow as this loop keeps them, and the loop
    // reads the directory rather than a list so a fifth subagent cannot arrive
    // with the defaults intact.
    for (const subagent of readdirSync(join(agentRoot, "subagents"))) {
      expect(disabledFrameworkToolsIn(join("subagents", subagent, "tools")), subagent).toEqual(
        DISABLED_FRAMEWORK_TOOLS,
      );
    }

    // Eve rejects a disableTool() file whose slug is not a framework tool at
    // build time, so this is the other direction: every framework tool is either
    // disabled above or kept on purpose, and none is merely unconsidered.
    expect(await frameworkToolNames()).toEqual(
      [...ROOT_DISABLED_FRAMEWORK_TOOLS, ...KEPT_FRAMEWORK_TOOLS].sort(),
    );
  });

  it("dispatches scheduled workflows without a chat session and gates Discord delivery", () => {
    // The dispatcher persists briefs by calling the shared generator directly; it
    // must not start an Eve chat session. Phase 3 Morning Agenda may pass a
    // Discord sender hook into the shared schedule dispatcher. Post-Meeting
    // Aftercare runs from the same root schedule and persists reviewable proposals
    // before attempting opt-in delivery.
    const source = readFileSync(join(agentRoot, "schedules/brief-dispatcher.ts"), "utf8");
    // Strip comments so the doc comment's mention of receive(...) is not matched as
    // a call; we check the actual code only.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toMatch(/\breceive\b/);
    expect(code).toMatch(/dispatchBirthdayGiftPlanning/);
    expect(code).toMatch(/dispatchDueBriefs/);
    expect(code).toMatch(/dispatchPostMeetingAftercare/);
    // The Phase 5 scoped action summary (#186) runs from the same root schedule.
    expect(code).toMatch(/dispatchActionSummary/);
    expect(code).toMatch(/createDiscordProactiveDeliverySender/);
    expect(code).toMatch(/discordSender/);
    expect(code).toMatch(/weeklyRelationshipReviewDiscordSender/);
  });

  it("has no background follow-up scanner or periodic suggestion generator (Phase 1E)", () => {
    const toolFiles = listAuthoredFiles(agentRoot).filter((file) => file.startsWith("tools/"));

    // Suggested follow-ups are produced only by the explicit-flow propose tool;
    // no tool scans/sweeps everyone or runs on a schedule to invent follow-ups
    // (PRD #42, issue #49).
    expect(toolFiles.some((file) => /scan|sweep|digest|cron|background|periodic/i.test(file))).toBe(
      false,
    );
    // The only tool that creates suggested follow-ups is the explicit propose
    // tool; the rest of the suggested-follow-up tools only review existing ones.
    const followupProducers = toolFiles.filter(
      (file) => /followup/i.test(file) && /propose|generate|create_suggest/i.test(file),
    );
    expect(followupProducers).toEqual(["tools/propose_followup.ts"]);
  });

  it("does not add extraction review tools or user-facing model-debugging surfaces", () => {
    const files = listAuthoredFiles(agentRoot);
    const toolFiles = files.filter((file) => file.startsWith("tools/"));
    const sandboxFiles = files.filter((file) => file.startsWith("sandbox/"));

    expect(sandboxFiles).toEqual([]);
    expect(sandboxFiles.some((file) => /extraction|model|debug/i.test(file))).toBe(false);
    expect(files.some((file) => /extraction.*(inbox|sandbox|debug|mode)/i.test(file))).toBe(false);
    expect(toolFiles.some((file) => /extract|model|debug/i.test(file))).toBe(false);
    expect(toolFiles).toEqual(
      expect.arrayContaining([
        "tools/cleanup_preview.ts",
        "tools/list_suggested_memory_reviews.ts",
        "tools/get_suggested_memory_review.ts",
        "tools/approve_suggested_memory.ts",
        "tools/dismiss_suggested_memory.ts",
      ]),
    );
  });
});
