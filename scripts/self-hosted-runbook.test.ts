import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const runbookPath = resolve(root, "docs/self-hosting/vercel-operator-runbook.md");

function readRunbook() {
  return readFileSync(runbookPath, "utf8");
}

describe("operator-owned Vercel runbook", () => {
  it("binds the documented variables and journey to the executable admission policy", () => {
    const runbook = readRunbook();
    const admissionSource = readFileSync(resolve(root, "packages/domain/src/admission.ts"), "utf8");
    const resolverSource = readFileSync(
      resolve(root, "packages/db/src/queries/access-profiles/admission.ts"),
      "utf8",
    );
    const invitationSource = readFileSync(
      resolve(root, "packages/db/src/queries/households/invitations.ts"),
      "utf8",
    );

    for (const variable of [
      "TENDNOTE_ADMISSION_MODE",
      "TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL",
    ]) {
      expect(admissionSource).toContain(variable);
      expect(runbook).toContain(variable);
    }

    expect(admissionSource).toContain('z.enum(["hosted", "self-hosted"])');
    expect(runbook).toMatch(/absent|omitted|unset/i);
    expect(runbook).toContain("hosted");
    expect(runbook).toContain("self-hosted");
    expect(runbook).toContain("owner@example.test");
    expect(runbook).toContain("self_hosted_bootstrap");
    expect(runbook).toContain("household_invitation");

    for (const outcome of [
      "bootstrap owner",
      "pending",
      "invitation",
      "matching",
      "durable",
      "invalid",
      "Flags",
      "Web",
      "Eve",
      "Access Decision",
    ]) {
      expect(runbook).toContain(outcome);
    }

    for (const prerequisite of ["Vercel", "Neon", "Redis", "model", "OAuth", "mail"]) {
      expect(runbook).toMatch(new RegExp(prerequisite, "i"));
    }

    for (const boundary of [
      "deploy button",
      "container",
      "platform-neutral",
      "multi-tenant",
      "unverified provider",
    ]) {
      expect(runbook).toMatch(new RegExp(boundary, "i"));
    }

    expect(resolverSource).toContain('source: "self_hosted_bootstrap"');
    expect(invitationSource).toContain('source: "household_invitation"');
    expect(resolverSource).toMatch(/Hosted Flags is fail-closed/);
  });

  it("does not publish live account values or secrets", () => {
    const runbook = readRunbook();

    expect(runbook).not.toMatch(/(?:dpl|prj)_[A-Za-z0-9]+/);
    expect(runbook).not.toMatch(/(?:sk|key|secret|token)_[A-Za-z0-9]{12,}/i);
    expect(runbook).not.toContain("nick-neely");
    expect(runbook).not.toContain("stacklet.app");
  });
});
