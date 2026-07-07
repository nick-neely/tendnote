import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the component DOM harness convention so the jsdom setup can't silently rot
 * (ADR 0161 follow-up, #191). This is a node-env source scan — the same structure-first
 * style as `apps/agent/tests/phase-5-boundaries.test.ts` — not itself a DOM test.
 *
 * Two invariants, both cheap and both real hazards:
 *   1. Every DOM test opts into jsdom. `apps/web` runs the default `node` environment, and
 *      vitest 4 removed `environmentMatchGlobs`; a `projects` split would risk changing how
 *      the existing node suites run, so the per-file `// @vitest-environment jsdom` docblock
 *      stays the mechanism — and this test makes it non-optional (a `*.dom.test.tsx` without
 *      it would run under node and fail confusingly, or worse, pass against a stale DOM).
 *   2. Nothing imports React Testing Library directly except the shared harness
 *      (`src/test/dom.tsx`). RTL's auto-`cleanup` keys off a global `afterEach`, which this
 *      repo does not enable (`globals` is off), so `dom.tsx` wires cleanup explicitly. A test
 *      that reached past it to `@testing-library/react` would silently skip cleanup and leak
 *      mounted trees between tests. Routing every DOM test through `dom.tsx` keeps that guard
 *      in exactly one place.
 */

const SRC_DIR = join(import.meta.dirname, "..");
const HARNESS_FILE = "test/dom.tsx";

/** Every `.ts`/`.tsx` file under `apps/web/src`, as paths relative to the src dir. */
function sourceFiles(): string[] {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(abs);
      }
      return /\.tsx?$/.test(entry.name) ? [relative(SRC_DIR, abs)] : [];
    });
  }
  return walk(SRC_DIR);
}

const ALL_SOURCES = sourceFiles();
const DOM_TESTS = ALL_SOURCES.filter((path) => path.endsWith(".dom.test.tsx"));

// Matches an actual import/re-export/dynamic-import of a `@testing-library/*` package — an
// `import`, `export … from`, or `import("…")` specifier — so a package name merely mentioned
// in prose (as in this file) never counts.
const TESTING_LIBRARY_IMPORT = /(?:from|import)\s*\(?\s*["']@testing-library\/[^"']+["']/;

describe("component DOM harness convention", () => {
  it("has DOM tests to guard (sanity: the harness is actually in use)", () => {
    expect(DOM_TESTS.length).toBeGreaterThan(0);
  });

  it("requires every *.dom.test.tsx to opt into the jsdom environment", () => {
    const missing = DOM_TESTS.filter(
      (path) => !readFileSync(join(SRC_DIR, path), "utf8").includes("@vitest-environment jsdom"),
    );
    expect(missing, `these DOM tests lack the '// @vitest-environment jsdom' docblock`).toEqual([]);
  });

  it("routes all React Testing Library use through the shared harness (src/test/dom.tsx)", () => {
    const offenders = ALL_SOURCES.filter(
      (path) =>
        path !== HARNESS_FILE &&
        TESTING_LIBRARY_IMPORT.test(readFileSync(join(SRC_DIR, path), "utf8")),
    );
    expect(
      offenders,
      `import DOM test helpers from "@/test/dom" (which wires cleanup) rather than @testing-library/* directly`,
    ).toEqual([]);
  });
});
