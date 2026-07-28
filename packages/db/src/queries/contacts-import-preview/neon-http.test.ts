import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyOwnerContactImportCandidates } from "../contacts-import-preview";
import { applyContactImportCandidatesWithAffectedScopes } from "./service";

vi.mock("../../client", () => ({
  getDb: vi.fn(() => ({
    transaction: vi.fn(() => {
      throw new Error("No transactions support in neon-http driver");
    }),
  })),
}));

vi.mock("./service", () => ({
  applyContactImportCandidatesWithAffectedScopes: vi.fn(),
  createContactImportPreviewSession: vi.fn(),
}));

describe("applyOwnerContactImportCandidates with neon-http", () => {
  beforeEach(() => {
    vi.mocked(applyContactImportCandidatesWithAffectedScopes).mockReset();
  });

  it("does not wrap contact-import apply in an unsupported transaction", async () => {
    vi.mocked(applyContactImportCandidatesWithAffectedScopes).mockResolvedValue({
      result: {
        importedCount: 0,
        createdPeople: 0,
        updatedPeople: 0,
        addedContactMethods: 0,
        addedBirthdays: 0,
        candidates: [],
        notImported: [],
        undoAvailable: false,
      },
      affectedScopes: [],
    });

    await expect(
      applyOwnerContactImportCandidates({
        ownerUserId: "owner-1",
        mode: "explicit",
        confirmations: [
          { candidateId: "candidate-1", expectedFingerprint: "fp-1", action: "skip" },
        ],
        adapter: { fetchContacts: vi.fn() },
      }),
    ).resolves.toMatchObject({ result: { importedCount: 0 }, affectedScopes: [] });

    expect(applyContactImportCandidatesWithAffectedScopes).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        mode: "explicit",
        confirmations: [
          { candidateId: "candidate-1", expectedFingerprint: "fp-1", action: "skip" },
        ],
      }),
      expect.objectContaining({
        isProviderCapabilityConnected: expect.any(Function),
        createProviderReference: expect.any(Function),
        createAuditLogEntry: expect.any(Function),
      }),
    );
  });

  it("routes the production Contact Import adapter through the affected-scope seam", () => {
    // This repo has no live Drizzle adapter harness. Per #315, the production
    // half of the store contract is an intentional source-wiring guard; the
    // behavioral half runs against the service's in-memory dependencies.
    const source = readFileSync(
      join(import.meta.dirname, "..", "contacts-import-preview.ts"),
      "utf8",
    );
    expect(source).toContain("return applyContactImportCandidatesWithAffectedScopes(input, {");
  });
});
