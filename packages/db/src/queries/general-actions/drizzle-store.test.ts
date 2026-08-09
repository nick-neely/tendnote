import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-assertion guard, matching this package's migration-shape test convention:
// the drizzle store has no live-DB harness, so we pin the two production behaviors
// the in-memory store cannot exercise for it — the defaults-free update parse and
// the surfacing-time ordering. A revert of either fails here.
const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");
const publicQuerySource = readFileSync(
  join(import.meta.dirname, "..", "general-actions.ts"),
  "utf8",
);

describe("general actions drizzle store guards", () => {
  it("validates update patches with the defaults-free schema, not a base partial", () => {
    // `generalActionSchema.partial().parse(patch)` injects `.default()` values for
    // absent keys and silently wipes columns (dueAt, notes, links, scope) on every
    // update. The store must use the defaults-free `generalActionUpdateSchema`.
    expect(source).toContain("generalActionUpdateSchema.parse(input.patch)");
    expect(source).not.toContain("generalActionSchema.partial(");
  });

  it("orders listings by surfacing time (coalesce(deferUntil, dueAt) nulls last)", () => {
    // Must match the in-memory store's `surfacingTime` so both back the surface
    // identically (see the store contract).
    expect(source).toContain("coalesce(");
    expect(source).toContain("generalActions.deferUntil");
    expect(source).toContain("generalActions.dueAt");
    expect(source).toContain("nulls last");
  });

  it("filters visible reads with the shared household scope predicate", () => {
    // The visible reads must go through the one shared scope predicate so General
    // Actions inherit the exact private/household/shared rules other records use —
    // no bespoke, drift-prone visibility SQL (ADR 0153). Aliased as `ga` to match
    // the predicate builder.
    expect(source).toContain("visibleHouseholdRecordSql");
    expect(source).toContain('recordKind: "general_action"');
    expect(source).toContain('tableAlias: "ga"');
  });

  it("proves the single-record visible read before returning the row", () => {
    // The predicate narrows; the proof authorizes. Without this call a row that
    // passed a stale-by-a-request SQL filter would be returned unchecked, and the
    // record's lifecycle, sensitivity, and exclusion facts — which SQL cannot see —
    // would never be consulted at all (ADR 0219).
    expect(source).toContain("provenVisibleRecord");
    expect(source).toContain('kind: "general_action"');
    // Null on refusal, so it is indistinguishable from an action that is not there.
    expect(source).toContain("proven ? generalActionSchema.parse(proven) : null");
    expect(source).toContain('alias(generalActions, "ga")');
  });

  it("replaces an action's people links atomically in a transaction", () => {
    // A link edit deletes then re-inserts; wrapping it in a transaction avoids a
    // window where the surface reads a half-applied set of people (ADR 0155).
    expect(source).toContain(".transaction(");
    expect(source).toContain("generalActionPeople");
  });

  it("creates an action and its initial attachments in one transaction", () => {
    expect(source).toContain("async createGeneralActionBundle(input)");
    expect(source).toContain("householdRecordShares");
    expect(source).toContain("generalActionEvents");
  });

  it("owner-keys the people-link reads and writes", () => {
    // The link methods must key on the action's owner — set-people guards ownership
    // inside its transaction, list-person-ids joins `general_actions` — so a direct
    // store caller can't read or rewrite another owner's links (#180 store hygiene).
    expect(source).toContain(".innerJoin(generalActions");
    expect(source).toContain("eq(generalActions.ownerUserId, input.ownerUserId)");
  });

  it("routes the production Drizzle lifecycle through the adapter-independent affected-scope seam", () => {
    expect(publicQuerySource).toContain(
      "createAffectedGeneralActionLifecycle(\n  defaultGeneralActionStore",
    );
  });
});
