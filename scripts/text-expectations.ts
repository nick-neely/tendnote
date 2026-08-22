import { expect } from "vitest";

/**
 * Assert that a published document still carries every one of these clauses.
 *
 * The publication contracts are long runs of "this wording must still be
 * there"; written one `expect` at a time the assertion scaffolding repeats
 * until the clauses are hard to read past. `toMatch` still names the exact
 * pattern that failed.
 */
export function expectAllMatch(text: string, patterns: readonly (RegExp | string)[]): void {
  for (const pattern of patterns) expect(text).toMatch(pattern);
}
