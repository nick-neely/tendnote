import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectAllowedAgentChannels, expectChannelToExclude } from "./agent-channel-boundaries";

const agentRoot = join(import.meta.dirname, "../agent");
const repoRoot = join(import.meta.dirname, "../../..");

/**
 * Phase 1F boundary evals on the Eve/agent surface (PRD #65, issue #74). They
 * confirm in-app brief generation did not introduce external delivery channels,
 * sandboxes, or workflow surfaces, and that the domain language stays aligned with
 * the persisted-brief model.
 */
describe("Phase 1F agent-surface boundaries", () => {
  it("keeps Phase 1F brief generation out of external delivery channels", () => {
    // Phase 3 may add a private capture channel, but Phase 1F brief generation
    // still must not add a delivery channel or provider send surface.
    expectAllowedAgentChannels(agentRoot);
    expectChannelToExclude(
      agentRoot,
      "discord.ts",
      /brief|sendgrid|resend|nodemailer|twilio|telegram|slack|teams/i,
    );
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
