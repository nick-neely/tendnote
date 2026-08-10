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
    // Dependencies and tool output are not the source this guards. Skipping every
    // dot directory covers `.git`, `.next`, `.turbo`, `.vercel`, and the agent's
    // `.eve` snapshots, which hold whole copies of the tree and can carry dangling
    // symlinks that a bare stat would throw on.
    if (entry === "node_modules" || entry.startsWith(".")) {
      continue;
    }
    const path = join(dir, entry);
    const stats = statSync(path, { throwIfNoEntry: false });
    if (!stats) {
      continue;
    }
    if (stats.isDirectory()) {
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
  const sql = read(PACKAGE_ROOT, "migrations", "0066_gift_plans_and_surprise_subjects.sql");

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
 * The derived surfaces a Gift Plan is still deliberately not on.
 *
 * ADR 0216 lists Search, Eve, Household, Today, reminders, and notifications
 * among the places the Surprise Subject must not meet the plan. #389 satisfied
 * that by registering the family nowhere at all; #390 registered it in Search and
 * Eve through the seam's own proved read, which is the shape the ADR asks for —
 * an adapter over the one query layer, not a second answer to who may see a plan.
 *
 * The three below stay empty, and each for its own reason rather than by inertia:
 *
 * - **Semantic retrieval.** A shared embedding index is a similarity space; it
 *   structurally cannot carry a domain exclusion, and a vector that answers "what
 *   was I planning for Ana's birthday" would answer it for Ana. A Gift Plan is
 *   deliberately not an embedded record kind, which is also why it reaches recall
 *   as an exact family with no related tier
 *   (`apps/web/src/lib/eve/semantic-boundaries.test.ts` pins the same rule from
 *   the route side).
 * - **Reminder schedules.** The reminder subscription proof does not yet thread
 *   `excludedUserIds`, so registering the kind would put a protected plan one
 *   missing field away from a notification to its own subject.
 * - **Today.** A Gift Plan's own decision doc admits it to Today only under the
 *   ordinary deterministic relevance rule, which is a Today-side contract that
 *   does not exist yet.
 *
 * A future adapter is expected to delete the line it breaks *and* route through
 * `queries/gift-plans`, and this is where that conversation starts.
 */
describe("no unproved derived surface can produce a Gift Plan", () => {
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

/**
 * Search and Eve reach a Gift Plan only through the seam.
 *
 * Global Recall gained a `gift_plan` family and Eve gained tools in #390. Both are
 * thin adapters by construction: they call `searchGiftPlans`, which narrows in SQL
 * with the exclusion clause and then proves every surviving row. This pins that
 * they never grew a query of their own — a recall normalizer or a tool that read
 * the tables would compile, pass its own tests, and quietly answer a Surprise
 * Subject.
 */
describe("Search and Eve reach a Gift Plan only through the seam", () => {
  const adapters: Array<{ what: string; file: string[] }> = [
    { what: "Global Recall", file: [PACKAGE_ROOT, "src", "queries", "global-recall.ts"] },
    {
      what: "the Eve search tool",
      file: [REPO_ROOT, "apps", "agent", "agent", "tools", "search_gift_plans.ts"],
    },
    {
      what: "the Eve contribution tool",
      file: [REPO_ROOT, "apps", "agent", "agent", "tools", "add_gift_idea.ts"],
    },
  ];

  for (const adapter of adapters) {
    it(`has ${adapter.what} import the seam and nothing beneath it`, () => {
      const source = read(...adapter.file);
      expect(source).toMatch(/from "(@tendnote\/db\/queries\/gift-plans|\.\/gift-plans)"/);
      // No store, no lifecycle factory, no table: the free functions only.
      expect(source).not.toContain("createGiftPlanLifecycle");
      expect(source).not.toContain("gift-plans/drizzle-store");
    });
  }
});
