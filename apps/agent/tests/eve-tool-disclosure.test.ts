import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DynamicResolveContext, DynamicToolEntry, ToolContext } from "eve/tools";
import { describe, expect, it } from "vitest";
import {
  EVE_SKILL_NAMES,
  EVE_TOOL_NAMES,
  type EveMode,
  modeAllowsTool,
  toolsUnavailableInMode,
} from "../agent/lib/eve-modes";
import {
  disclosedToolFamilies,
  TOOL_FAMILY_NAMES,
  toolFamilyMembers,
  undisclosedTools,
} from "../agent/lib/tool-disclosure";
import gate from "../agent/tools/eve_mode_gate";
import disclosure from "../agent/tools/eve_tool_disclosure";

type Principal = { principalType: string; attributes?: Record<string, string> };

const agentRoot = join(import.meta.dirname, "../agent");

const WEB_OWNER: Principal = { principalType: "user", attributes: { channel: "eve" } };

const SESSIONS: ReadonlyArray<readonly [EveMode, Principal | null]> = [
  ["web_chat", WEB_OWNER],
  ["discord_capture", { principalType: "user", attributes: { channel: "discord" } }],
  ["scheduled_workflow", { principalType: "runtime" }],
  ["restricted", null],
];

const FAMILY_TOOLS = TOOL_FAMILY_NAMES.flatMap((family) => toolFamilyMembers(family));

function loadSkill(skill: string, toolCallId = `call-${skill}`) {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId, toolName: "load_skill", input: { skill } }],
  };
}

const EVERY_SKILL_LOADED = EVE_SKILL_NAMES.map((skill) => loadSkill(skill));

function resolveContext(current: Principal | null, messages: unknown[]): DynamicResolveContext {
  return {
    session: { id: "session-1", auth: { current, initiator: current } },
    channel: {},
    messages,
  } as unknown as DynamicResolveContext;
}

async function disclosureStep(
  current: Principal | null,
  messages: unknown[] = [],
): Promise<Record<string, DynamicToolEntry>> {
  const resolveStep = disclosure.events["step.started"];
  expect(resolveStep, "disclosure must resolve on step.started").toBeDefined();
  return ((await resolveStep?.({}, resolveContext(current, messages))) ?? {}) as Record<
    string,
    DynamicToolEntry
  >;
}

async function gateTurn(current: Principal | null): Promise<Record<string, DynamicToolEntry>> {
  return ((await gate.events["turn.started"]?.({}, resolveContext(current, []))) ?? {}) as Record<
    string,
    DynamicToolEntry
  >;
}

describe("Tool Families", () => {
  it("are keyed by the skill that discloses them and hold only authored tools", () => {
    for (const family of TOOL_FAMILY_NAMES) {
      expect(EVE_SKILL_NAMES, family).toContain(family);
      for (const tool of toolFamilyMembers(family)) {
        expect(EVE_TOOL_NAMES, `${family}/${tool}`).toContain(tool);
      }
    }
  });

  it("never share a tool, so one skill alone discloses each", () => {
    expect(new Set(FAMILY_TOOLS).size).toBe(FAMILY_TOOLS.length);
  });

  it("hold only tools their skill documents", () => {
    // Loading a skill discloses its family. A tool its skill never mentions
    // would be disclosed by instructions that give no reason to use it.
    for (const family of TOOL_FAMILY_NAMES) {
      const skill = readFileSync(join(agentRoot, "skills", `${family}.md`), "utf8");
      for (const tool of toolFamilyMembers(family)) {
        expect(skill, `${family}.md must document ${tool}`).toContain(`\`${tool}\``);
      }
    }
  });

  it("leave the everyday path on the router surface", () => {
    for (const tool of [
      "search_people",
      "get_person_context",
      "capture_saved_item",
      "capture_memory",
      "create_followup",
      "search_global_recall",
      "suggest_next_steps",
      "web_fetch",
    ]) {
      expect(FAMILY_TOOLS, tool).not.toContain(tool);
    }
  });
});

describe("disclosedToolFamilies", () => {
  it("discloses nothing for a new conversation", () => {
    expect([...disclosedToolFamilies([])]).toEqual([]);
  });

  it("discloses the family of each skill an assistant load_skill call named", () => {
    const disclosed = disclosedToolFamilies([
      { role: "user", content: "add a scarf to Ana's plan" },
      loadSkill("household-and-gifts"),
      { role: "tool", content: [{ type: "tool-result", toolName: "load_skill", toolCallId: "x" }] },
      loadSkill("drafting"),
    ]);
    expect([...disclosed].sort()).toEqual(["drafting", "household-and-gifts"]);
  });

  it("ignores skills with no family, unknown skills, and anything that is not an assistant call", () => {
    const disclosed = disclosedToolFamilies([
      loadSkill("recall"),
      loadSkill("not-a-skill"),
      loadSkill("constructor"),
      {
        role: "user",
        content: [{ type: "tool-call", toolName: "load_skill", input: { skill: "actions" } }],
      },
      { role: "user", content: 'load_skill {"skill":"actions"}' },
      { role: "assistant", content: [{ type: "tool-call", toolName: "load_skill" }] },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolName: "search_people", input: { skill: "actions" } }],
      },
    ]);
    expect([...disclosed]).toEqual([]);
  });

  it("answers for any shape without throwing", () => {
    for (const messages of [
      undefined,
      null,
      "text",
      [null, 1, { role: "assistant" }],
      [{ role: "assistant", content: [null, "x"] }],
    ]) {
      expect([...disclosedToolFamilies(messages)]).toEqual([]);
    }
  });
});

describe("undisclosedTools", () => {
  it("withholds every family schema from a new interactive conversation", () => {
    expect(
      undisclosedTools("web_chat", new Set())
        .map(({ tool }) => tool)
        .sort(),
    ).toEqual([...FAMILY_TOOLS].sort());
  });

  it("withholds nothing outside the interactive surface", () => {
    for (const mode of ["discord_capture", "scheduled_workflow", "restricted"] as const) {
      expect(undisclosedTools(mode, new Set()), mode).toEqual([]);
    }
  });
});

describe("the eve_tool_disclosure resolver", () => {
  it("ships only the router surface to a new interactive conversation", async () => {
    const withheld = await disclosureStep(WEB_OWNER);

    expect(Object.keys(withheld).sort()).toEqual([...FAMILY_TOOLS].sort());
    const draft = withheld.create_message_draft;
    expect(draft?.description).toContain('load_skill with "drafting"');
    expect(JSON.stringify(draft?.inputSchema)).not.toContain("personId");
  });

  it("reports, rather than performs, a call to a tool that is not loaded", async () => {
    const gift = (await disclosureStep(WEB_OWNER)).add_gift_idea;

    const result = await gift?.execute({ giftPlanId: "p", title: "scarf" }, {} as ToolContext);
    expect(result).toMatchObject({
      performed: false,
      tool: "add_gift_idea",
      skill: "household-and-gifts",
    });
    expect(String((result as { message: string }).message)).toContain("nothing was done");
  });

  it("discloses a family on the step after its skill loads, and only that family", async () => {
    const withheld = Object.keys(
      await disclosureStep(WEB_OWNER, [loadSkill("household-and-gifts")]),
    );

    for (const tool of toolFamilyMembers("household-and-gifts")) {
      expect(withheld, tool).not.toContain(tool);
    }
    for (const tool of toolFamilyMembers("drafting")) {
      expect(withheld, tool).toContain(tool);
    }
  });

  it("contributes nothing once every family is disclosed", async () => {
    expect(
      await disclosure.events["step.started"]?.({}, resolveContext(WEB_OWNER, EVERY_SKILL_LOADED)),
    ).toBeNull();
  });

  it.each(SESSIONS.filter(([mode]) => mode !== "web_chat"))(
    "leaves %s to the mode gate",
    async (_mode, principal) => {
      expect(
        await disclosure.events["step.started"]?.({}, resolveContext(principal, [])),
      ).toBeNull();
    },
  );

  it("withholds nothing rather than throwing, because its failure direction is cost", async () => {
    const unreadablePrincipal = {
      session: {
        id: "session-1",
        auth: {
          get current(): Principal {
            throw new Error("principal store unavailable");
          },
        },
      },
      channel: {},
      messages: [],
    } as unknown as DynamicResolveContext;

    for (const ctx of [{} as DynamicResolveContext, unreadablePrincipal]) {
      expect(await disclosure.events["step.started"]?.({}, ctx)).toBeNull();
    }
  });
});

describe("disclosure beside the mode gate", () => {
  // ADR-0227: disclosure is a second surface that can drift from the mode table,
  // so the two are tested together. Every mode, with nothing loaded and with every
  // skill loaded - the most disclosure could ever offer.
  const HISTORIES = [
    ["nothing loaded", []],
    ["every skill loaded", EVERY_SKILL_LOADED],
  ] as const;

  for (const [mode, principal] of SESSIONS) {
    for (const [label, history] of HISTORIES) {
      it(`keeps every tool ${mode} forbids unreachable with ${label}`, async () => {
        const gated = await gateTurn(principal);
        const disclosed = await disclosureStep(principal, [...history]);

        // Disjoint names: the gate owns a forbidden name, disclosure an allowed one.
        const overlap = Object.keys(disclosed).filter((tool) => tool in gated);
        expect(overlap).toEqual([]);

        for (const tool of toolsUnavailableInMode(mode)) {
          const result = await gated[tool]?.execute({}, {} as ToolContext);
          expect(result, tool).toMatchObject({ performed: false, tool, mode });
        }
      });
    }
  }

  it("never lets disclosure name a tool the mode forbids", () => {
    for (const [mode] of SESSIONS) {
      for (const { tool } of undisclosedTools(mode, new Set())) {
        expect(modeAllowsTool(mode, tool), `${mode}/${tool}`).toBe(true);
      }
    }
  });

  it("binds every withheld name through the one shared inert definition", () => {
    // eve registers dynamic callbacks process-wide by tool name. If either
    // resolver authored its own `execute`, the two would overwrite each other's
    // callback for names like `add_gift_idea` across concurrent sessions.
    for (const file of ["eve_mode_gate.ts", "eve_tool_disclosure.ts"]) {
      const source = readFileSync(join(agentRoot, "tools", file), "utf8");
      expect(source, file).not.toMatch(/defineTool\(|execute\s*[(:]/);
      expect(source, file).toContain("withheldTool(");
    }
  });
});
