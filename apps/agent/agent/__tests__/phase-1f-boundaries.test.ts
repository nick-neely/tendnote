import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentRoot = join(import.meta.dirname, "..");
const repoRoot = join(import.meta.dirname, "../../../..");

/**
 * Phase 1F boundary evals on the Eve/agent surface (PRD #65, issue #74). They
 * confirm in-app brief generation did not introduce external delivery channels,
 * sandboxes, or workflow surfaces, and that the domain language stays aligned with
 * the persisted-brief model.
 */
describe("Phase 1F agent-surface boundaries", () => {
  it("adds no external delivery channels — only the same-origin Eve channel", () => {
    const channels = readdirSync(join(agentRoot, "channels"));
    // External email/push/calendar/chat delivery is out of scope for Phase 1F
    // (PRD #65, ADR-0066). No slack/discord/twilio/telegram/teams channels.
    expect(channels).toEqual(["eve.ts"]);
  });

  it("adds no sandbox, workflow, or connection surfaces", () => {
    for (const dir of ["sandbox", "sandboxes", "workflows", "connections", "subagents"]) {
      expect(existsSync(join(agentRoot, dir))).toBe(false);
    }
  });

  it("keeps domain language aligned with the persisted brief-item model", () => {
    const context = readFileSync(join(repoRoot, "CONTEXT.md"), "utf8");
    expect(context).toContain("Daily Brief");
    expect(context).toContain("Weekly Relationship Review");
    // The weekly review must be the same persisted brief model, not a separate queue.
    expect(context).toMatch(/same persisted brief-item model/i);
  });

  it("keeps the governing ADRs present", () => {
    for (const adr of [
      "0008-persist-generated-briefs.md",
      "0044-weekly-review-after-daily-briefs.md",
      "0066-brief-schedules-use-app-owned-dispatcher.md",
    ]) {
      expect(existsSync(join(repoRoot, "docs", "adr", adr))).toBe(true);
    }
  });
});
