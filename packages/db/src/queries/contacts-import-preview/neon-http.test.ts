import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyOwnerContactImportCandidates } from "../contacts-import-preview";
import { applyContactImportCandidates } from "./service";

vi.mock("../../client", () => ({
  getDb: vi.fn(() => ({
    transaction: vi.fn(() => {
      throw new Error("No transactions support in neon-http driver");
    }),
  })),
}));

vi.mock("./service", () => ({
  applyContactImportCandidates: vi.fn(),
  createContactImportPreviewSession: vi.fn(),
}));

describe("applyOwnerContactImportCandidates with neon-http", () => {
  beforeEach(() => {
    vi.mocked(applyContactImportCandidates).mockReset();
  });

  it("does not wrap contact-import apply in an unsupported transaction", async () => {
    vi.mocked(applyContactImportCandidates).mockResolvedValue({
      importedCount: 0,
      createdPeople: 0,
      updatedPeople: 0,
      addedContactMethods: 0,
      addedBirthdays: 0,
      candidates: [],
      undoAvailable: false,
    });

    await expect(
      applyOwnerContactImportCandidates({
        ownerUserId: "owner-1",
        mode: "explicit",
        resolutions: [{ candidateId: "candidate-1", action: "skip" }],
        adapter: { fetchContacts: vi.fn() },
      }),
    ).resolves.toMatchObject({ importedCount: 0 });

    expect(applyContactImportCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        mode: "explicit",
        resolutions: [{ candidateId: "candidate-1", action: "skip" }],
      }),
      expect.objectContaining({
        isProviderCapabilityConnected: expect.any(Function),
        createProviderReference: expect.any(Function),
        createAuditLogEntry: expect.any(Function),
      }),
    );
  });
});
