import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";

/**
 * Structural out-of-scope boundary shared by the read-only relationship workflows: they
 * compose briefs and never deliver them, so their query modules must import no autonomous
 * mutation, provider read/write, or external-send machinery. Reads a module's static
 * imports and asserts none match any forbidden pattern. Each workflow supplies its own
 * pattern list because the exact out-of-scope surface differs per brief (ADR-driven #187
 * boundary suite).
 */
export function expectNoForbiddenImports(relativeSourcePath: string, forbidden: RegExp[]) {
  const source = readFileSync(join(process.cwd(), relativeSourcePath), "utf8");
  const importSources = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

  for (const moduleId of importSources) {
    for (const pattern of forbidden) {
      expect(moduleId).not.toMatch(pattern);
    }
  }
}
