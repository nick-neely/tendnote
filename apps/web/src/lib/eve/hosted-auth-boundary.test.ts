import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = process.cwd();
const agentRoot = join(webRoot, "../agent");

describe("hosted Eve authentication boundary", () => {
  it("terminates auth in the Eve service mounted by withEve", () => {
    const nextConfig = readFileSync(join(webRoot, "next.config.ts"), "utf8");
    const channel = readFileSync(join(agentRoot, "agent/channels/eve.ts"), "utf8");

    expect(nextConfig).toContain("withEve");
    expect(channel).toContain("createTendnoteSessionAuth");
    expect(channel).toContain("createLocalOwnerAuth");
    expect(channel).not.toContain("x-tendnote-owner-id");
  });

  it("has no obsolete Next proxy claiming to guard direct Eve service routes", () => {
    expect(existsSync(join(webRoot, "src/proxy.ts"))).toBe(false);
    expect(existsSync(join(webRoot, "src/lib/access/eve-ingress.ts"))).toBe(false);
  });

  it("never falls back to demo-user inside owner-scoped tools", () => {
    const owner = readFileSync(join(agentRoot, "agent/lib/owner.ts"), "utf8");

    expect(owner).toContain("An authenticated Tendnote owner is required");
    expect(owner).not.toContain("demo-user");
    expect(owner).not.toContain("TENDNOTE_DEV_OWNER_USER_ID");
  });
});
