/**
 * Turns a snake_case Eve tool name into a human-readable phrase ("search_people" →
 * "search people"). Shared by the in-flight shimmer label and the generic result
 * fallback so the last-resort humanization stays one implementation.
 */
export function humanizeToolName(toolName: string): string {
  return toolName.replace(/_/g, " ");
}
