import { expect } from "vitest";

/**
 * Assert that authored instruction text carries every one of these rules.
 *
 * The subagent and instruction tests are long runs of "this clause must still
 * be there", and written out one `expect` at a time they are near-identical
 * across files - the shape of the assertion drowns out the rule being asserted.
 * Listing the patterns keeps each test about its clauses, and `toMatch` still
 * names the exact failing pattern.
 */
export function expectAllMatch(text: string, patterns: readonly (RegExp | string)[]): void {
  for (const pattern of patterns) expect(text).toMatch(pattern);
}
