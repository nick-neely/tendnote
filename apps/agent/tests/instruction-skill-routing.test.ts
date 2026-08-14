import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RENDERED_TOOL_NAMES } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { baseInstructions } from "./instructions-source";

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
 * pins the shape of the rule rather than a list that would rot on the next registry
 * change.
 */

const base = baseInstructions();
const skillSlugs = readdirSync(join(process.cwd(), "agent/skills"))
  .filter((file) => file.endsWith(".md"))
  .map((file) => file.replace(/\.md$/, ""))
  .sort();

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
    expect(RENDERED_TOOL_NAMES.length).toBeLessThan(
      readdirSync(join(process.cwd(), "agent/tools")).filter((file) => file.endsWith(".ts")).length,
    );
    expect(base).not.toMatch(/most tools surface/i);
    expect(base).toMatch(/rendered in a card/i);
    expect(base).toMatch(/plain data with no card.*summarize/is);
  });
});
