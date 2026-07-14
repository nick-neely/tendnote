import { describe, expect, it } from "vitest";
import { authoredInstructions, baseInstructions } from "./instructions-source";

/**
 * The review gate on asset-linked reminders (#203, PRD #196 stories 40/57/58). An Asset's
 * reviewed details can *propose* General Actions — a warranty check, a filter replacement
 * Routine — but Eve proposes; the user decides. The boundary is enforced in code (the
 * proposal seam only ever writes `suggested` rows), and these checks pin the guidance
 * that keeps Eve from talking as though it were otherwise: no silent durable writes, no
 * autonomous asset manager, and no re-pushing a proposal the user already turned down.
 *
 * The standing "propose, never create" rule is always-on, so it lives in base.md; the
 * tool workflow lives in the actions skill. Both are asserted, base.md specifically.
 */

const base = baseInstructions();
const authored = authoredInstructions();

describe("asset reminder proposals are review-gated (#203)", () => {
  it("states the propose-never-create rule in the always-on instructions", () => {
    expect(base).toMatch(/asset reminders are proposed, never created/i);
    expect(base).toMatch(/propose_asset_actions/);
    expect(base).toMatch(/never turn an asset detail into an active action/i);
  });

  it("refuses the autonomous-asset-manager framing", () => {
    // PRD #196 explicitly excludes an autonomous asset manager and a standalone asset
    // notification system. Eve must not narrate itself into either.
    expect(base).toMatch(/you are not an asset manager/i);
    expect(authored).toMatch(/you propose, the user decides/i);
    expect(authored).toMatch(/no separate asset reminder system/i);
  });

  it("keeps an explicit user instruction on the create path, not the proposal path", () => {
    // "Add a reminder to replace the filter every 6 months" is the user's own words —
    // that is create_general_action. Proposals are for reminders Eve *inferred*.
    expect(base).toMatch(/create_general_action/);
    expect(authored).toMatch(/an explicit ask is not a proposal/i);
    expect(authored).toMatch(/reserve `?propose_asset_actions`? for reminders \*?you\*? inferred/i);
  });

  it("only reviewed details propose, and only dated or recurring ones", () => {
    // A suggested memory must not cascade past its own review gate, and a filter size is
    // recall, not a reminder — the two refusals the planning rule enforces in code.
    expect(authored).toMatch(/only reviewed details propose/i);
    expect(authored).toMatch(/only dates and intervals propose/i);
    expect(authored).toMatch(/recall, not a reminder/i);
    expect(authored).toMatch(/already passed proposes nothing/i);
  });

  it("forbids re-pushing a proposal the user already turned down", () => {
    // The no-nag rule. The seam refuses to re-propose a dismissed memory; the guidance
    // must stop Eve from "trying again" to force one past the user by other means.
    expect(authored).toMatch(/calling it twice is safe and silent/i);
    expect(authored).toMatch(/do not "?try again"? to force a reminder the user dismissed/i);
    expect(authored).toMatch(/that is nagging/i);
  });

  it("says accepted asset reminders are ordinary Actions on the existing surfaces", () => {
    expect(authored).toMatch(/appear on the ledger, on today when due, in the daily summary/i);
  });
});
