import type { LegalDocument } from "@tendnote/domain/legal-documents";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, getCurrentAccess, recordAcceptances } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  getCurrentAccess: vi.fn(),
  recordAcceptances: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@tendnote/db/queries/acceptance-records", () => ({ recordAcceptances }));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess }));

import { acceptUpdatedTermsAction } from "./reacceptance";

const user = { id: "user-1", email: "ada@example.com" };
const updatedTerms: LegalDocument = {
  key: "terms_of_service",
  title: "Terms of Service",
  version: "0.2",
  effectiveDate: "2026-11-01",
  path: "docs/legal/terms-of-service.md",
  reacceptance: { changes: ["Fair-use limits are now stated in Eve turns."] },
};

function shownForm(versions: Record<string, string>) {
  const form = new FormData();
  for (const [key, version] of Object.entries(versions)) form.set(key, version);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentAccess.mockResolvedValue({
    state: "reacceptance",
    user,
    decision: { admitted: false, status: "denied", profile: null },
    documents: [updatedTerms],
  });
});

describe("acceptUpdatedTermsAction", () => {
  it("records acceptance of the versions the gate showed, then lets the account through", async () => {
    await expect(acceptUpdatedTermsAction(shownForm({ terms_of_service: "0.2" }))).rejects.toThrow(
      "REDIRECT:/",
    );

    expect(recordAcceptances).toHaveBeenCalledWith({ userId: "user-1", documents: [updatedTerms] });
  });

  it("records nothing for a version the page never showed", async () => {
    await expect(acceptUpdatedTermsAction(shownForm({ terms_of_service: "0.1" }))).rejects.toThrow(
      "REDIRECT:/accept-terms",
    );

    expect(recordAcceptances).not.toHaveBeenCalled();
  });

  it("records nothing for an account that owes nothing", async () => {
    getCurrentAccess.mockResolvedValue({ state: "admitted", user, ownerUserId: "user-1" });

    await expect(acceptUpdatedTermsAction(shownForm({ terms_of_service: "0.2" }))).rejects.toThrow(
      "REDIRECT:/",
    );
    expect(recordAcceptances).not.toHaveBeenCalled();
  });

  it("sends a signed-out request to sign-in", async () => {
    getCurrentAccess.mockResolvedValue({ state: "unauthenticated" });

    await expect(acceptUpdatedTermsAction(shownForm({}))).rejects.toThrow("REDIRECT:/sign-in");
    expect(recordAcceptances).not.toHaveBeenCalled();
  });
});
