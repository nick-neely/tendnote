import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RENDERED_TOOL_NAMES } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { baseInstructions } from "./instructions-source";
import { effectiveToolSource } from "./tool-source";

/**
 * The two always-on claims that were false, and the reason they are worth a test.
 *
 * Eve loads a skill only when the model calls `load_skill` with the skill's slug, and
 * a slug is its filename. `base.md` used to promise skills "load automatically when
 * the request matches" and then name them in prose ("self context", "capturing &
 * review") - so the model was told not to do the one thing that reaches them, using
 * names that would not have resolved if it had tried. Deriving the expected slugs from
 * the directory means a new skill that nothing routes to fails here rather than
 * shipping unreachable.
 *
 * The second is the render contract. Only some tools persist a typed card
 * (`RENDERED_TOOL_NAMES`); the rest are text-only, and the old rule told the model
 * "most tools surface their result as a card … never paste the card's contents back
 * into your reply", which suppressed output for a read the user could not see at all.
 * The fix is a behavioral rule keyed on what each result says about itself, so this
 * pins the shape of the rule - and holds every rendered tool to actually saying it -
 * rather than a list that would rot on the next registry change.
 */

const base = baseInstructions();
const skillSlugs = readdirSync(join(process.cwd(), "agent/skills"))
  .filter((file) => file.endsWith(".md"))
  .map((file) => file.replace(/\.md$/, ""))
  .sort();

const toolsDir = join(process.cwd(), "agent/tools");
const subagentsDir = join(process.cwd(), "agent/subagents");

/**
 * A root tool's effective source, or null when the name belongs to a subagent
 * instead. A registration file that pulls its definition from `agent/lib/tools/`
 * carries no `toModelOutput` of its own, so the render declaration lives in the
 * shared definition and the guard has to read it there.
 */
function readRootTool(name: string): string | null {
  const path = join(toolsDir, `${name}.ts`);
  return existsSync(path) ? effectiveToolSource(path) : null;
}

/** The subagents that own a tool of this name. */
function subagentOwners(name: string): string[] {
  return readdirSync(subagentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(subagentsDir, entry.name, "tools", `${name}.ts`)))
    .map((entry) => entry.name);
}

/**
 * Whether a tool tells the model its result is rendered. The declaration has to live
 * in the payload the model actually reads: the `toModelOutput` projection, or the
 * whole file for a tool that hands its `execute` return straight to the model
 * (`get_person_context`). The value has to reach a string literal, so a `rendered:`
 * forwarding an expression that can be empty at runtime does not count, while a
 * conditional between two strings does - `propose_asset_actions` renders no card on a
 * pass that proposes nothing, and says so.
 */
function declaresRendered(source: string): boolean {
  const modelOutput = source.indexOf("toModelOutput");
  const payload = modelOutput < 0 ? source : source.slice(modelOutput);
  return /[\s{,]rendered:\s*[^:{}]*?"/.test(payload);
}

describe("skills are reachable: base.md routes to load_skill by exact slug", () => {
  it("tells the model skills do not load themselves and names the tool that loads them", () => {
    expect(base).toMatch(/Skills do not load themselves/i);
    expect(base).toMatch(/`load_skill`/);
  });

  it("routes to every authored skill by its exact slug", () => {
    expect(skillSlugs.length).toBeGreaterThan(0);
    for (const slug of skillSlugs) {
      expect(base, `base.md must route to the \`${slug}\` skill by slug`).toContain(`\`${slug}\``);
    }
  });

  it("gives every skill a description frontmatter that says when to load it", () => {
    for (const slug of skillSlugs) {
      const source = readFileSync(join(process.cwd(), `agent/skills/${slug}.md`), "utf8");
      expect(source, `${slug}.md needs description frontmatter`).toMatch(
        /^---\ndescription: Use when [^\n]+\n---\n/,
      );
    }
  });
});

describe("the render contract matches what the tool registry actually renders", () => {
  it("keys the no-reprint rule on what the result says, not on 'most tools'", () => {
    // Not every tool renders: `list_due_followups`, `list_self_context`,
    // `list_calendar_events`, and `search_people` all return text the user never sees.
    expect(base).not.toMatch(/most tools surface/i);
    expect(base).toMatch(/rendered in a card/i);
    expect(base).toMatch(/plain data with no card.*summarize/is);
  });

  it("says so in the model-facing result of every root tool that renders a card", () => {
    // A rule keyed on the result only works if the results carry the key. Every name
    // in RENDERED_TOOL_NAMES persists a typed card the user is already looking at, so
    // a result that omits `rendered` reads to the model as the plain-data case and
    // gets summarized back out - the reprint the rule exists to stop. The guard this
    // replaced compared list lengths, which stayed true however many rendered tools
    // forgot to declare it.
    const rootRendered = RENDERED_TOOL_NAMES.flatMap((name) => {
      const source = readRootTool(name);
      return source === null ? [] : [{ name, source }];
    });
    expect(rootRendered.length).toBeGreaterThan(0);

    for (const { name, source } of rootRendered) {
      expect(
        declaresRendered(source),
        `${name} renders a card, so the result the model reads needs a \`rendered\` line`,
      ).toBe(true);
    }
  });

  it("accounts for every rendered name with no root tool file", () => {
    // `propose_memory_cleanup` and `propose_message_draft` render cards but belong to
    // subagents, which do not load `base.md` and so are not held to its no-reprint
    // rule. Resolving them to a real subagent tool keeps that exemption honest: a
    // rendered name matching no source at all is registry drift, not a subagent.
    for (const name of RENDERED_TOOL_NAMES.filter((name) => readRootTool(name) === null)) {
      expect(
        subagentOwners(name),
        `${name} has no tool file under agent/tools or agent/subagents/*/tools`,
      ).not.toHaveLength(0);
    }
  });
});
