import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");

/**
 * Consolidated Phase 5 General Actions boundary scan (PRD #177, ADRs 0143-0167). Phase 5
 * ships a bounded "personal OS" action model — Actions and Routines, flat Areas, household
 * scopes, review-gated suggestions, retrieval, ten Eve tools, a narrow Today surface, and a
 * count-only scoped Discord summary — and DELIBERATELY nothing more. These structure-first
 * scans pin the cross-cutting *absence* invariants the ADRs promise, so a regression that
 * quietly grows Phase 5 into project management, an external task/calendar integration, a
 * standalone notification system, document/asset management, or productivity analytics is
 * mechanically hard to introduce even if every per-slice test still passes.
 *
 * They read source + migrations only and never touch the network. Two deliberate design
 * choices keep the scans honest:
 *   - Migration scans read EVERY file in `packages/db/migrations`, not a hardcoded Phase 5
 *     set, so a future migration that adds (say) a `priority` column to `general_actions`
 *     is automatically in scope and fails the allowlist rather than slipping past.
 *   - Source scans strip comments before matching (see {@link stripComments}), so a future
 *     doc comment that merely *names* an excluded thing ("we avoid RRULE per ADR 0147")
 *     cannot fail the suite — only real code identifiers count.
 *
 * The positive behavior (lifecycle, recurrence, scope, review promotion, extraction
 * idempotency, retrieval filtering, Eve mutation boundary, scoped delivery, and the full
 * journey) is proven by the slice suites and by
 * `packages/db/src/queries/phase-5-general-actions-e2e.test.ts`.
 *
 * DOCUMENTED GAP (AC2 "mobile-usable UI behavior", AC5) — NARROWED by #191, not fully closed:
 * the mobile assertions below stay SOURCE-LEVEL — they confirm the Today/Actions surfaces are
 * built with the repo's mobile-first responsive utilities (vertical `flex flex-col` stacking,
 * `sm:` reflow), never fixed-pixel layout. They remain the *absence* boundary; they are no
 * longer the only mobile coverage. A jsdom component DOM harness now exists (`apps/web/src/test/dom.tsx`,
 * `*.dom.test.tsx`) and exercises real interaction at a narrow width: the Area filter
 * click-through (`actions-surface.dom.test.tsx`), the suggestion review-card accept/dismiss/edit
 * and error states (`chat-general-action-review-card.dom.test.tsx`, `suggested-general-action-review.dom.test.tsx`),
 * the deep-link scroll/focus/pulse hook (`use-deep-link-highlight.dom.test.tsx`), and the Today
 * glance's ledger-hop links plus control reachability at a phone width (`action-today-surface.dom.test.tsx`).
 * What is STILL open: jsdom has no layout engine, so it computes no CSS, media queries, or box
 * sizes — real pixel reflow at a breakpoint and touch-target sizing are not proven here and would
 * need a real-browser harness. That thinner residual is the remaining ADR 0161 gap.
 */

/**
 * Removes block and line comments from TS/TSX source so an absence scan matches only real
 * code, never prose. A `//` that is part of a `://` URL (preceded by `:`) is left intact,
 * so string literals like "https://…" survive; stripping can only ever *reduce* matches,
 * so it never manufactures a false pass for a genuine code identifier.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(relativePath: string): string {
  const full = join(repoRoot, relativePath);
  expect(existsSync(full), `${relativePath} should exist`).toBe(true);
  return readFileSync(full, "utf8");
}

/**
 * Every `.sql` file in the migrations directory, concatenated. Reading the whole directory
 * (rather than a fixed Phase 5 list) is what keeps the allowlists below anchored to the
 * *current* schema: a later migration that alters a Phase 5 table is scanned automatically.
 */
const MIGRATIONS_DIR = "packages/db/migrations";
const allMigrationsText = readdirSync(join(repoRoot, MIGRATIONS_DIR))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => read(`${MIGRATIONS_DIR}/${name}`))
  .join("\n");

/** The column names declared inside a table's `CREATE TABLE "name" (...)` block. */
function createTableColumns(tableName: string): string[] {
  const start = allMigrationsText.indexOf(`CREATE TABLE "${tableName}" (`);
  expect(start, `migrations should CREATE TABLE ${tableName}`).toBeGreaterThanOrEqual(0);
  const block = allMigrationsText.slice(start, allMigrationsText.indexOf(");", start));
  // The column name is the first quoted token on each indented column line; constraints
  // live in separate ALTER statements, so this block is columns only.
  return [...block.matchAll(/^\s+"([a-z_]+)"/gm)].map((match) => match[1] as string);
}

/** Every column any `ALTER TABLE "name" ADD COLUMN "x"` adds to a table, across all migrations. */
function addedColumns(tableName: string): string[] {
  const re = new RegExp(`ALTER TABLE "${tableName}" ADD COLUMN "([a-z_]+)"`, "g");
  return [...allMigrationsText.matchAll(re)].map((match) => match[1] as string);
}

/** A table's full current column set: its CREATE TABLE columns plus every later ADD COLUMN. */
function columnsForTable(tableName: string): string[] {
  return [...createTableColumns(tableName), ...addedColumns(tableName)];
}

describe("Phase 5 boundary — the general_actions schema is a bounded action model", () => {
  it("carries exactly the bounded action columns — no priority, assignment, tags, ordering, or subtask/dependency columns", () => {
    // Allowlist (not a blocklist): the general_actions table must carry ONLY these columns
    // across ALL migrations, so ANY new column — a priority/importance rank, an assignee, a
    // parent_task_id/depends_on (subtasks/dependencies), a kanban column or board position,
    // or a tags array — fails this test until it is justified, whichever migration adds it.
    // This is the structural proof that Phase 5 stays a bounded personal-OS model (ADRs
    // 0145, 0166).
    expect([...columnsForTable("general_actions")].sort()).toEqual(
      [
        "area_id",
        "asset_hints",
        "completed_at",
        "created_at",
        "created_by_user_id",
        "defer_until",
        "due_at",
        "household_id",
        "id",
        "last_actor_user_id",
        "links",
        "notes",
        "owner_user_id",
        "recurrence",
        "scope",
        // The generated tsvector backing exact recall (ADR 0150, #184) — a retrieval index,
        // not a product field. Added by migration 0036, which only the all-migrations scan
        // reaches (a hardcoded Phase 5 file list would have missed it).
        "search_vector",
        "source_record_id",
        "status",
        "title",
        "updated_at",
      ].sort(),
    );
  });

  it("keeps people a lightweight link, never folding a personId onto the action (Follow-Ups stay relationship-specific)", () => {
    // A General Action links people through a separate join table — it never carries a
    // person_id column, so linking a person is context, not a conversion into a
    // person-centered Follow-Up (ADRs 0143, 0155). The join table is the only place the
    // relationship lives.
    expect(columnsForTable("general_actions")).not.toContain("person_id");
    expect([...columnsForTable("general_action_people")].sort()).toEqual(
      ["created_at", "general_action_id", "id", "person_id"].sort(),
    );
  });

  it("tracks history without productivity analytics — the events table carries no score/streak/rank column", () => {
    // The lifecycle-history table is an append-only trail: id, action, owner, kind, actor,
    // detail, timestamp. No numeric score, streak count, points, or ranking column, so
    // history can never become gamification or predictive prioritization (ADR 0165).
    expect([...columnsForTable("general_action_events")].sort()).toEqual(
      [
        "actor_user_id",
        "created_at",
        "detail_json",
        "general_action_id",
        "id",
        "kind",
        "owner_user_id",
      ].sort(),
    );
  });
});

describe("Phase 5 boundary — Areas are custom and flat, not nested projects", () => {
  it("carries exactly the flat-Area columns — no parent_id (nesting) and no permission columns", () => {
    // Areas are a flat life-category label, one primary per Action — not a project tree and
    // not an ACL surface. No parent_id/parent_area_id (nesting), no per-Area permission or
    // role columns (ADR 0146). Area-level permissions are explicitly out of Phase 5 scope.
    const areas = columnsForTable("general_action_areas");
    expect([...areas].sort()).toEqual(
      [
        "archived_at",
        "created_at",
        "id",
        "name",
        "owner_user_id",
        "sort_order",
        "updated_at",
      ].sort(),
    );
    for (const forbidden of ["parent_id", "parent_area_id", "permissions", "role", "acl"]) {
      expect(areas).not.toContain(forbidden);
    }
  });
});

describe("Phase 5 boundary — recurrence is simple, and Routines are a label, not a model", () => {
  it("stores recurrence as one embedded cadence column, never an RRULE engine or a separate routines table", () => {
    // Recurrence is a single jsonb column on general_actions (an `{interval, unit}` cadence),
    // NOT a table of recurrence rules, exceptions, or per-occurrence overrides (ADR 0147).
    expect(allMigrationsText).toContain(
      'ALTER TABLE "general_actions" ADD COLUMN "recurrence" jsonb',
    );
    // Routine is a product label for a recurring General Action — there is no separate
    // routines/tasks/projects/subtasks table anywhere in the migrations (ADR 0148).
    for (const forbidden of [
      'CREATE TABLE "routines"',
      'CREATE TABLE "tasks"',
      'CREATE TABLE "projects"',
      'CREATE TABLE "subtasks"',
      'CREATE TABLE "action_dependencies"',
      'CREATE TABLE "recurrence_rules"',
      'CREATE TABLE "recurrence_exceptions"',
      'CREATE TABLE "action_tags"',
    ]) {
      expect(allMigrationsText).not.toContain(forbidden);
    }
  });
});

// Every non-test source file on the General Actions path across db, domain, and the Eve
// tools — the surfaces that could grow an external integration or a notification system.
function walk(dir: string, predicate: (name: string) => boolean): string[] {
  const abs = join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(rel, predicate);
    return predicate(entry.name) ? [rel] : [];
  });
}

const isSource = (name: string) => /\.tsx?$/.test(name) && !/\.test\./.test(name);

const GENERAL_ACTION_TOOL_FILES = walk("apps/agent/agent/tools", (name) =>
  /general_action/.test(name),
);

const ACTIONS_PATH_SOURCES = [
  ...walk("packages/db/src/queries/general-actions", isSource),
  ...walk("packages/db/src/queries/general-action-areas", isSource),
  ...walk("packages/db/src/queries/action-extraction-jobs", isSource),
  "packages/db/src/queries/action-summary.ts",
  "packages/domain/src/general-actions.ts",
  "packages/domain/src/general-action-areas.ts",
  "packages/domain/src/action-extraction.ts",
  ...GENERAL_ACTION_TOOL_FILES,
];

// Comment-stripped so the scans below match only real code identifiers, never prose that
// happens to name an excluded concept (the ADRs are cited by name throughout these files).
const actionsCode = ACTIONS_PATH_SOURCES.map(read).map(stripComments).join("\n").toLowerCase();

describe("Phase 5 boundary — no external task/calendar writes, no standalone notifications, no document management", () => {
  it("never imports or references an external task/reminder/calendar provider from the actions path", () => {
    // Phase 5 defers external task/reminder writes and external calendar writes entirely —
    // an Action lives only in Tendnote (ADRs 0160, 0166). No third-party task system and no
    // recurrence/calendar-sync library appears in the actual code on the actions path.
    for (const forbidden of [
      "todoist",
      "asana",
      "trello",
      "clickup",
      "jira",
      "monday.com",
      "tasks.googleapis",
      "caldav",
      "icalendar",
      "rrule",
      ".ics",
    ]) {
      expect(actionsCode).not.toContain(forbidden);
    }
  });

  it("adds no standalone notification system — the only proactive send is the shared scoped Discord summary", () => {
    // Phase 5 defers a standalone notification system; proactive reach is the count-only,
    // scope-gated summary riding the shared scheduled-workflow delivery service, not a push
    // channel or an email/SMS pipeline (ADRs 0158, 0162).
    for (const forbidden of [
      "web-push",
      "onesignal",
      "firebase",
      "apns",
      "sendgrid",
      "twilio",
      "nodemailer",
      "service worker",
      "serviceworker",
    ]) {
      expect(actionsCode).not.toContain(forbidden);
    }
  });

  it("keeps links and asset hints lightweight — no upload, file storage, or document/asset records", () => {
    // Links are plain URLs and asset hints are plain labels; Phase 5 stores no uploads,
    // files, blobs, or durable asset records (ADRs 0156, 0164). Concrete storage/upload
    // identifiers plus the structural table check carry the proof (the ADR comments
    // legitimately name "warranty"/"serials" as excluded, so those words are not scanned).
    // The blanket `CREATE TABLE "assets"` absence check retired with Phase 6 (#196/#197),
    // which deliberately introduces the durable Asset record; the Phase 5 boundary that
    // remains is that the *actions path* never grows attachments or file storage.
    for (const forbidden of [
      "multipart",
      "presigned",
      "getobjectcommand",
      "putobjectcommand",
      "@aws-sdk",
      "attachment_url",
      "createuploadurl",
    ]) {
      expect(actionsCode).not.toContain(forbidden);
    }
    for (const forbidden of [
      'CREATE TABLE "general_action_attachments"',
      'CREATE TABLE "general_action_files"',
    ]) {
      expect(allMigrationsText).not.toContain(forbidden);
    }
  });
});

describe("Phase 5 boundary — Action surfaces are built mobile-usable (ADR 0161, source-level)", () => {
  // SOURCE-LEVEL absence boundary — see the DOCUMENTED GAP note in the file header. These
  // assert the surfaces are authored with the repo's mobile-first responsive utilities; they
  // do not render or measure layout. Real interaction/reachability at a narrow width now has
  // DOM coverage in the web `*.dom.test.tsx` harness (#191); true pixel reflow stays out of
  // scope for jsdom.
  const TODAY_SURFACE = read("apps/web/src/components/action-today-surface.tsx");
  const ACTIONS_SURFACE = read("apps/web/src/components/actions-surface.tsx");

  it("lays the Today and Actions surfaces out mobile-first (vertical flex stacking, no fixed-pixel layout)", () => {
    for (const surface of [TODAY_SURFACE, ACTIONS_SURFACE]) {
      // Mobile-first vertical stacking is the baseline layout on a narrow viewport.
      expect(surface).toMatch(/flex\s+flex-col/);
      // No fixed pixel width on a layout container (e.g. `w-[420px]`), which would overflow
      // a phone. Character-count `ch` measures for prose line-length are fine and excluded.
      expect(surface).not.toMatch(/\bw-\[\d+px\]/);
    }
  });

  it("reflows the denser Actions surface on wider viewports via a `sm:` breakpoint", () => {
    // The Actions ledger row goes column-on-mobile → row-at-`sm:`, the repo's standard
    // responsive reflow — proof the surface adapts to width rather than assuming desktop.
    expect(ACTIONS_SURFACE).toMatch(/\bsm:/);
  });
});

describe("Phase 5 boundary — Eve exposes a bounded, single-record General Action tool surface (ADR 0159)", () => {
  it("exposes exactly the ten General Action tools — no bulk, assignment, prioritization, or ranking tool", () => {
    // The ten explicit-instruction tools and nothing else. A bulk/sweep, assign, prioritize,
    // rank, or reorder tool would break the explicit, single-record mutation boundary
    // (ADRs 0159, 0163), so the tool surface is pinned as an exact set.
    expect([...GENERAL_ACTION_TOOL_FILES].map((path) => path.split("/").pop()).sort()).toEqual(
      [
        "accept_suggested_general_action.ts",
        "create_general_action.ts",
        "dismiss_suggested_general_action.ts",
        "edit_general_action.ts",
        "get_suggested_general_action_review.ts",
        "list_general_actions.ts",
        "list_suggested_general_action_reviews.ts",
        "plan_suggested_general_actions.ts",
        "suggest_general_action.ts",
        "update_general_action_status.ts",
      ].sort(),
    );
    for (const path of GENERAL_ACTION_TOOL_FILES) {
      expect(path).not.toMatch(/bulk|sweep|assign|priorit|rank|reorder|kanban/i);
    }
  });

  it("keeps the always-on explicit-mutation boundary and its evals present", () => {
    // The explicit-turn mutation boundary is enforced in base instructions and covered by
    // both behavior and policy evals (ADR 0159). Their presence guards the cross-cutting
    // Eve boundary without a redundant model run here.
    const base = read("apps/agent/agent/instructions/base.md");
    expect(base).toMatch(/Only create or change a durable Action on an explicit ask\./);
    for (const evalFile of [
      "apps/agent/evals/policy/general-action-explicit-mutation-boundary.eval.ts",
      "apps/agent/evals/behavior/general-action-mutation-boundary.eval.ts",
      "apps/agent/evals/behavior/external-action-boundary.eval.ts",
      "apps/agent/evals/behavior/general-action-planning-boundary.eval.ts",
    ]) {
      expect(existsSync(join(repoRoot, evalFile)), `${evalFile} present`).toBe(true);
    }
  });

  it("gives every id-taking tool a reachable persisted action id", () => {
    const projection = stripComments(read("apps/agent/agent/lib/general-action-view.ts"));
    expect(projection).toMatch(/id:\s*ref\.id/);

    const idSources = [
      "list_general_actions.ts",
      "list_suggested_general_action_reviews.ts",
      "get_suggested_general_action_review.ts",
      "plan_suggested_general_actions.ts",
    ];
    for (const file of idSources) {
      expect(stripComments(read(`apps/agent/agent/tools/${file}`))).toMatch(
        /toGeneralActionModelRef/,
      );
    }

    const idConsumers = [
      "update_general_action_status.ts",
      "edit_general_action.ts",
      "get_suggested_general_action_review.ts",
      "accept_suggested_general_action.ts",
      "dismiss_suggested_general_action.ts",
    ];
    for (const file of idConsumers) {
      expect(stripComments(read(`apps/agent/agent/tools/${file}`))).toMatch(
        /generalActionId:\s*z\s*\.uuid\(/,
      );
    }
  });

  it("curates store failures before every General Action tool can return them to the model", () => {
    for (const path of GENERAL_ACTION_TOOL_FILES) {
      expect(stripComments(read(path)), `${path} wraps its store calls`).toMatch(
        /withModelSafeStoreErrors/,
      );
    }
  });
});

describe("Phase 5 boundary — the governing ADRs are present", () => {
  it("keeps every Phase 5 ADR (0143-0167) on disk", () => {
    const adrDir = join(repoRoot, "docs/adr");
    const adrs = readdirSync(adrDir);
    for (let n = 143; n <= 167; n += 1) {
      const prefix = `0${n}-`;
      expect(
        adrs.some((name) => name.startsWith(prefix)),
        `ADR ${prefix}* present`,
      ).toBe(true);
    }
  });
});
