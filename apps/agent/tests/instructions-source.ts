import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Collapse whitespace so markdown line-wrapping never breaks a phrase assertion. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Always-on base instructions, whitespace-normalized. */
export function baseInstructions(root: string = process.cwd()): string {
  return normalize(readFileSync(join(root, "agent/instructions/base.md"), "utf8"));
}

/**
 * The full authored instruction surface the agent reads: the always-on `base.md`
 * plus every on-demand skill, whitespace-normalized. Eve keeps situational tool
 * workflows in skills, which the model pulls into context by calling `load_skill`
 * with the slug, so guidance that lives in a skill is still authored agent guidance —
 * these checks assert the whole surface, not just `base.md`, so moving a workflow
 * into a skill doesn't make the rule "disappear" from the evals' point of view.
 */
export function authoredInstructions(root: string = process.cwd()): string {
  const base = readFileSync(join(root, "agent/instructions/base.md"), "utf8");
  const skillsDir = join(root, "agent/skills");
  const skills = readdirSync(skillsDir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => readFileSync(join(skillsDir, file), "utf8"));
  return normalize([base, ...skills].join("\n\n"));
}
