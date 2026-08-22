import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAdmissionHarness } from "../apps/web/src/lib/access/admission-harness";
import type { createPrivateBetaAccessResolver } from "../apps/web/src/lib/access/resolve-access";
import {
  createAccessProfileQueries,
  createInMemoryAccessProfileStore,
} from "../packages/db/src/queries/access-profiles";
import { parseAdmissionPolicy } from "../packages/domain/src/admission";

const root = resolve(import.meta.dirname, "..");
const runbookPath = resolve(root, "docs/self-hosting/vercel-operator-runbook.md");
const REQUEST = new Request("https://operator.example.test/eve/v1/session");

function readRunbook() {
  return readFileSync(runbookPath, "utf8");
}

function readDocumentedAdmissionEnvironment(runbook: string) {
  const block = runbook.match(/```text\n([\s\S]*?TENDNOTE_ADMISSION_MODE[\s\S]*?)\n```/)?.[1];
  if (!block) throw new Error("The runbook must contain its admission variable block.");

  const assignments = block.split("\n").flatMap((line) => {
    const match = /^(TENDNOTE_[A-Z0-9_]+)=(.*)$/.exec(line);
    return match ? [[match[1], match[2]]] : [];
  });

  return {
    assignments,
    environment: Object.fromEntries(assignments),
  };
}

async function assertDocumentedBoundary(input: {
  policy: Parameters<typeof createPrivateBetaAccessResolver>[0]["policy"];
  evaluateFlag: Parameters<typeof createPrivateBetaAccessResolver>[0]["evaluateFlag"];
  user: { id: string; email: string };
}) {
  const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
  await queries.ensureAccessProfile({ userId: input.user.id });
  const { eve, web } = createAdmissionHarness({ ...input, queries });

  const decision = await web.resolveAccess({ userId: input.user.id, email: input.user.email });
  expect(decision.admitted).toBe(false);
  await expect(eve(REQUEST)).rejects.toThrow(
    "Private Beta Access is required to use the assistant.",
  );

  return { decision, queries };
}

describe("operator-owned Vercel runbook", () => {
  it("parses the documented variables and executes the real policy at both boundaries", async () => {
    const runbook = readRunbook();
    const documented = readDocumentedAdmissionEnvironment(runbook);

    expect(documented.assignments).toEqual([
      ["TENDNOTE_ADMISSION_MODE", "hosted"],
      ["TENDNOTE_ADMISSION_MODE", "self-hosted"],
      ["TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL", "owner@example.test"],
    ]);
    expect(parseAdmissionPolicy(documented.environment)).toEqual({
      mode: "self-hosted",
      valid: true,
      bootstrapOwnerEmail: "owner@example.test",
    });

    // The documented omission is executable policy, not a prose default.
    expect(parseAdmissionPolicy({})).toEqual({ mode: "hosted", valid: true });

    const invalidFlag = vi.fn().mockResolvedValue(true);
    const invalid = await assertDocumentedBoundary({
      policy: parseAdmissionPolicy({ TENDNOTE_ADMISSION_MODE: "self-hosted" }),
      evaluateFlag: invalidFlag,
      user: { id: "invalid-visitor", email: "visitor@example.test" },
    });
    expect(invalid.decision).toMatchObject({ admitted: false, status: "pending", profile: null });
    expect(invalidFlag).not.toHaveBeenCalled();

    const hostedFlag = vi.fn().mockRejectedValue(new Error("Flags unavailable"));
    const hosted = await assertDocumentedBoundary({
      policy: parseAdmissionPolicy({}),
      evaluateFlag: hostedFlag,
      user: { id: "hosted-visitor", email: "hosted@example.test" },
    });
    expect(hosted.decision).toMatchObject({ admitted: false, status: "pending" });
    expect(hostedFlag).toHaveBeenCalledTimes(2);
    await expect(
      hosted.queries.getAccessProfile({ userId: "hosted-visitor" }),
    ).resolves.toMatchObject({
      status: "pending",
      source: null,
    });
  });

  it("keeps the runbook bounded to synthetic operator configuration", () => {
    const runbook = readRunbook();

    for (const prerequisite of ["Vercel", "Neon", "Redis", "model", "OAuth", "mail"]) {
      expect(runbook).toMatch(new RegExp(prerequisite, "i"));
    }
    for (const requiredVariable of [
      "BETTER_AUTH_URL",
      "BETTER_AUTH_SECRET",
      "DATABASE_URL",
      "REDIS_URL",
      "pnpm db:migrate",
    ]) {
      expect(runbook).toContain(requiredVariable);
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

    expect(runbook).not.toMatch(/(?:dpl|prj)_[A-Za-z0-9]+/);
    expect(runbook).not.toMatch(/(?:sk|key|secret|token)_[A-Za-z0-9]{12,}/i);
    expect(runbook).not.toContain("nick-neely");
    expect(runbook).not.toContain(["stacklet", "app"].join("."));
  });
});
