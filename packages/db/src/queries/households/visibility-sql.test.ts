import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateHouseholdAuthorization } from "@tendnote/domain";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "visibility-sql.ts"), "utf8");

const HOUSEHOLD = "household-1";
const OWNER = "owner-user";
const SELECTED = "selected-user";
const UNSELECTED = "unselected-user";
const DEPARTED = "departed-user";

/**
 * The audience truth table, written once. Both halves of this file check the same
 * table: the engine by running it, the SQL predicate by pinning the clauses that
 * have to be present for the database to reach the same answers.
 *
 * `activeMembers` names who currently holds an active membership in HOUSEHOLD.
 */
const ACTIVE = [
  { householdId: HOUSEHOLD, userId: OWNER },
  { householdId: HOUSEHOLD, userId: SELECTED },
  { householdId: HOUSEHOLD, userId: UNSELECTED },
];

const TRUTH_TABLE = [
  { scope: "private", caller: OWNER, visible: true },
  { scope: "private", caller: SELECTED, visible: false },
  { scope: "household", caller: OWNER, visible: true },
  { scope: "household", caller: SELECTED, visible: true },
  { scope: "household", caller: UNSELECTED, visible: true },
  { scope: "household", caller: DEPARTED, visible: false },
  { scope: "shared", caller: OWNER, visible: true },
  { scope: "shared", caller: SELECTED, visible: true },
  { scope: "shared", caller: UNSELECTED, visible: false },
  { scope: "shared", caller: DEPARTED, visible: false },
] as const;

/**
 * `visibleHouseholdRecordSql` is the read-side pre-filter and `scopedRecordAudience`
 * (through the proof) is the authority. They are two implementations of one rule
 * living in two languages, and this package has no live-DB harness to run them
 * against each other.
 *
 * So they are pinned from both sides in one file: the engine half runs the truth
 * table for real, and the SQL half asserts the clauses that make the predicate
 * capable of producing it. Changing either side alone fails here — the engine half
 * if the policy moves, the SQL half if the predicate does — which is the point.
 * Neither half can be updated to match the other without seeing both.
 */
describe("household visibility pre-filter and proof agree", () => {
  it.each(TRUTH_TABLE)("engine: $scope scope for $caller is $visible", ({
    scope,
    caller,
    visible,
  }) => {
    expect(
      evaluateHouseholdAuthorization({
        callerUserId: caller,
        operation: "view",
        subject: {
          kind: "general_action",
          id: "record-1",
          ownerUserId: OWNER,
          scope,
          householdId: scope === "private" ? null : HOUSEHOLD,
          audienceUserIds: scope === "shared" ? [SELECTED] : undefined,
        },
        callerActiveMemberships: ACTIVE.filter((membership) => membership.userId === caller),
      }).authorized,
    ).toBe(visible);
  });

  it("SQL: admits exactly the three scopes the policy defines and no fourth branch", () => {
    expect(source).toContain("scope = 'private'");
    expect(source).toContain("scope = 'household'");
    expect(source).toContain("scope = 'shared'");
    // A scope literal the policy does not know about would be an unreviewed branch.
    expect([...source.matchAll(/scope = '(\w+)'/g)].map((match) => match[1]).sort()).toEqual([
      "household",
      "private",
      "shared",
    ]);
  });

  it("SQL: keeps a private row with its owner", () => {
    expect(source).toMatch(/scope = 'private'\s*and \$\{record\}\.owner_user_id/);
  });

  it("SQL: requires a current active membership for both non-private scopes", () => {
    // Once per non-private branch: `household` and `shared`. A branch that stopped
    // checking membership would leave a departed member reading the household.
    expect(source.match(/hm\.status = 'active'/g)).toHaveLength(2);
    expect(source.match(/hm\.user_id = \$\{input\.callerUserId\}/g)).toHaveLength(2);
    expect(source.match(/household_id is not null/g)).toHaveLength(2);
  });

  it("SQL: narrows the shared branch to the owner or an explicit share row", () => {
    // Matched as patterns rather than literals: the predicate is a tagged
    // template, so the interpolations are part of the text being pinned.
    expect(source).toContain("from household_record_shares hrs");
    expect(source).toMatch(/hrs\.shared_with_user_id = \$\{input\.callerUserId\}/);
    expect(source).toMatch(/hrs\.record_kind = \$\{input\.recordKind\}/);
  });

  /**
   * The ownership dimension the truth table above cannot express.
   *
   * A household-native record has no `owner_user_id` at all, so the predicate's
   * two owner comparisons must be inert for it rather than accidentally
   * matching. In SQL they are: `NULL = 'someone'` is unknown, never true. The
   * engine half pins that the same rows resolve the way the workspace-owned form
   * requires - symmetric authority for every active member, nothing for anyone
   * else (ADR 0214).
   */
  describe.each([
    "view",
    "update",
    "archive",
  ] as const)("engine: workspace-owned records under %s", (operation) => {
    const subject = {
      kind: "saved_item",
      id: "record-2",
      ownerUserId: null,
      scope: "household",
      householdId: HOUSEHOLD,
      ownership: "household_native",
    } as const;

    it.each([OWNER, SELECTED, UNSELECTED])("admits active member %s", (caller) => {
      expect(
        evaluateHouseholdAuthorization({
          callerUserId: caller,
          operation,
          subject,
          callerActiveMemberships: ACTIVE.filter((membership) => membership.userId === caller),
        }),
      ).toMatchObject({ authorized: true, via: "household_authority" });
    });

    it("refuses someone who is no longer active", () => {
      expect(
        evaluateHouseholdAuthorization({
          callerUserId: DEPARTED,
          operation,
          subject,
          callerActiveMemberships: [],
        }).authorized,
      ).toBe(false);
    });
  });

  it("engine: never reads a null owner as an owner, even on a private row", () => {
    // The fail-closed direction: if a workspace-owned record ever ended up
    // `private`, it must reach nobody rather than everybody.
    expect(
      evaluateHouseholdAuthorization({
        callerUserId: OWNER,
        operation: "view",
        subject: {
          kind: "saved_item",
          id: "record-3",
          ownerUserId: null,
          scope: "private",
          householdId: null,
        },
        callerActiveMemberships: ACTIVE,
      }),
    ).toMatchObject({ authorized: false, denial: "not_owner" });
  });

  it("SQL: compares the owner column rather than assuming one exists", () => {
    // Both owner comparisons stay plain `=` against the column. A rewrite to
    // `coalesce(owner_user_id, …)` or `is not distinct from` would make a null
    // owner match something, which is how a workspace-owned row would start
    // leaking out through the private and shared branches.
    expect(source.match(/owner_user_id = \$\{input\.callerUserId\}/g)).toHaveLength(2);
    expect(source).not.toContain("coalesce(");
    expect(source).not.toContain("is not distinct from");
  });

  it("SQL: is documented as a pre-filter that does not authorize an operation", () => {
    // The comment is load-bearing: it is what stops the next author treating a row
    // that survived the predicate as an authorized read.
    expect(source).toMatch(/pre-filter/i);
    expect(source).toContain("createHouseholdAuthorizationProver");
  });
});
