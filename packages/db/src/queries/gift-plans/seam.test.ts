import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(import.meta.dirname, "..", "..", "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const SEAM_DIR = join(PACKAGE_ROOT, "src", "queries", "gift-plans");

function read(...segments: string[]) {
  return readFileSync(join(...segments), "utf8");
}

function walk(dir: string, matches: (path: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".turbo" || entry === ".git") {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path, matches));
    } else if (matches(path)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The pre-filter's two clauses, pinned in the language they are written in.
 *
 * The exclusion has to hold in SQL as well as in the proof, and SQL is the half
 * no unit test can exercise without a database. Reading the source is the cheap
 * way to keep the clause from being refactored away — the same trick the Saved
 * Item and General Action stores use for their own predicates.
 */
describe("the Gift Plan pre-filter", () => {
  const source = read(SEAM_DIR, "drizzle-store.ts");

  it("narrows candidates with the shared household visibility predicate", () => {
    expect(source).toContain("visibleHouseholdRecordSql");
    expect(source).toContain('tableAlias: "gp"');
    expect(source).toContain('recordKind: "gift_plan"');
  });

  it("excludes the Surprise Subject in SQL, null-safely and outside the audience clause", () => {
    expect(source).toContain("surprise_subject_user_id is distinct from");
    // `and`-ed with the audience predicate rather than folded into one of its
    // branches: no form of standing may reach past it.
    expect(source).toMatch(/visibleHouseholdRecordSql\([\s\S]*?\),\s*\n\s*notSurpriseSubjectSql\(/);
  });

  it("keeps the exclusion on the search path as well as the list path", () => {
    // One candidate query serves both, which is what stops Search from growing
    // its own answer to who may see a plan.
    expect(source.match(/notSurpriseSubjectSql\(input\.callerUserId\)/g)).toHaveLength(1);
    expect(source).toContain("listGiftPlanCandidates");
  });
});

describe("the migration", () => {
  const sql = read(PACKAGE_ROOT, "migrations", "0064_gift_plans_and_surprise_subjects.sql");

  it("creates the family's tables and the exclusion column", () => {
    expect(sql).toContain('CREATE TABLE "gift_plans"');
    expect(sql).toContain('CREATE TABLE "gift_ideas"');
    expect(sql).toContain('CREATE TABLE "gift_plan_events"');
    expect(sql).toContain('"surprise_subject_user_id" text');
    expect(sql).toContain("gift_plans_surprise_subject_idx");
  });

  it("registers the record kind the share registry and the proof key on", () => {
    expect(sql).toContain(`ALTER TYPE "public"."visibility_record_kind" ADD VALUE 'gift_plan'`);
  });
});

/**
 * The seam is the only door.
 *
 * Every derived surface a Gift Plan could appear on — list, search, counts,
 * provenance, deep links — reaches it through `queries/gift-plans`, which proves
 * before it answers. A module that imported the tables directly would be reading
 * around the exclusion, and it would compile and pass its own tests while doing
 * it. That is the failure this guards against, because the shared visibility
 * predicate every other family relies on structurally cannot see a domain
 * exclusion (ADR 0219).
 */
describe("the Gift Plan tables are reachable only through the seam", () => {
  const TABLE_NAMES = ["giftPlans", "giftIdeas", "giftPlanEvents"];
  const ALLOWED = [
    join("packages", "db", "src", "schema", "app", "gift-plans.ts"),
    join("packages", "db", "src", "schema", "app.ts"),
    join("packages", "db", "src", "queries", "gift-plans"),
  ];

  it("is not imported from the schema anywhere else", () => {
    const sources = walk(REPO_ROOT, (path) => /\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts"));

    const offenders = sources.filter((path) => {
      const relative = path.slice(REPO_ROOT.length + 1);
      if (ALLOWED.some((allowed) => relative.startsWith(allowed))) return false;
      const source = readFileSync(path, "utf8");
      // Only import statements count: prose in a comment is not a query.
      return source
        .split("\n")
        .some(
          (line) =>
            /^\s*(import|export)\b/.test(line) &&
            TABLE_NAMES.some((table) => new RegExp(`\\b${table}\\b`).test(line)),
        );
    });

    expect(offenders.map((path) => path.slice(REPO_ROOT.length + 1))).toEqual([]);
  });
});

/**
 * The derived surfaces a Gift Plan is deliberately not on yet.
 *
 * ADR 0216 lists Search, Eve, Household, Today, reminders, and notifications
 * among the places the Surprise Subject must not meet the plan. This slice
 * satisfies that by not registering the family in any of those pipelines: the
 * seam's own search is proved, and nothing else can produce a Gift Plan at all.
 *
 * The assertion is here rather than left implicit because "safe because it does
 * not exist" stops being true the moment someone widens one of these unions. A
 * future adapter is expected to delete the line it breaks *and* route through
 * `queries/gift-plans`, and this is where that conversation starts.
 */
describe("no derived surface can produce a Gift Plan yet", () => {
  const registries: Array<{ what: string; file: string[]; symbol: string }> = [
    {
      what: "semantic retrieval",
      file: [PACKAGE_ROOT, "src", "schema", "app", "enums.ts"],
      symbol: "semanticRecordKind",
    },
    {
      what: "reminder schedules",
      file: [PACKAGE_ROOT, "src", "schema", "app", "enums.ts"],
      symbol: "reminderRecordKind",
    },
    {
      what: "Today",
      file: [REPO_ROOT, "packages", "domain", "src", "today.ts"],
      symbol: "todayRecordKindSchema",
    },
    {
      what: "global recall",
      file: [REPO_ROOT, "packages", "domain", "src", "global-recall.ts"],
      symbol: "globalRecallFamilySchema",
    },
  ];

  for (const registry of registries) {
    it(`leaves ${registry.what} without a gift-plan member`, () => {
      const source = read(...registry.file);
      const declaration = source.slice(source.indexOf(registry.symbol));
      const block = declaration.slice(0, declaration.indexOf("]);"));
      expect(block).not.toContain("gift_plan");
      expect(block).not.toContain("gift-plan");
    });
  }
});
