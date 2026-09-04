/**
 * Turns a snake_case Eve tool name into a human-readable phrase ("search_people" →
 * "search people"). Shared by the in-flight shimmer label and the generic result
 * fallback so the last-resort humanization stays one implementation.
 *
 * The framework's own built-ins are namespaced (`eve:load-skill`), and the naive
 * humanization printed that straight into the transcript as "Eve:load-skill" —
 * the one word the product is never allowed to say to a reader. Stripping the
 * namespace is a floor, not a fix: a tool that reaches a reader through this
 * fallback at all is a tool nobody has written copy for, and the answer to that
 * is an entry in `active-tool-label.ts`. But the floor has to hold for whatever
 * eve adds next, because the alternative is the framework naming itself.
 */
export function humanizeToolName(toolName: string): string {
  return toolName
    .replace(/^(?:eve:|subagent:)/, "")
    .replace(/[_-]/g, " ")
    .trim();
}
