import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy } from "@/test/action-adapter-mocks";

const { closeFirstRun, closeIntegrationOffer } = vi.hoisted(() => ({
  closeFirstRun: vi.fn(),
  closeIntegrationOffer: vi.fn(),
}));

vi.mock("@tendnote/db/queries/first-run", () => ({ closeFirstRun, closeIntegrationOffer }));

import { closeIntegrationOfferAction, skipFirstRunAction } from "./first-run";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  closeFirstRun.mockResolvedValue(undefined);
  closeIntegrationOffer.mockResolvedValue(undefined);
});

describe("first-run actions", () => {
  it("closes the first run for the signed-in owner only", async () => {
    await expect(skipFirstRunAction()).resolves.toMatchObject({ ok: true });
    expect(closeFirstRun).toHaveBeenCalledWith({ userId: "owner-1" });
  });

  it("closes the integrations offer for the signed-in owner only", async () => {
    await expect(closeIntegrationOfferAction()).resolves.toMatchObject({ ok: true });
    expect(closeIntegrationOffer).toHaveBeenCalledWith({ userId: "owner-1" });
  });

  it("writes nothing for a caller who is not admitted", async () => {
    requireAdmittedOwnerForActionSpy.mockRejectedValue(new Error("not admitted"));
    await expect(skipFirstRunAction()).rejects.toThrow();
    expect(closeFirstRun).not.toHaveBeenCalled();
  });
});
