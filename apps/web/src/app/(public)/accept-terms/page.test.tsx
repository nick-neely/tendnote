import type { LegalDocument } from "@tendnote/domain/legal-documents";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, getCurrentAccess, getLatestOwnerDataExportJob, ownerHasExportableData } =
  vi.hoisted(() => ({
    redirect: vi.fn((to: string) => {
      throw new Error(`REDIRECT:${to}`);
    }),
    getCurrentAccess: vi.fn(),
    getLatestOwnerDataExportJob: vi.fn(),
    ownerHasExportableData: vi.fn(),
  }));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess }));
vi.mock("@tendnote/db/queries/owner-data-export", () => ({
  getLatestOwnerDataExportJob,
  ownerHasExportableData,
}));
vi.mock("@/components/account/delete-account-button", () => ({
  DeleteAccountButton: () => <button type="button">Delete account</button>,
}));
vi.mock("@/app/actions/reacceptance", () => ({ acceptUpdatedTermsAction: vi.fn() }));
vi.mock("@/components/auth/auth-scaffold", () => ({
  AuthScaffold: ({ title, children }: { title: string; children: unknown }) => (
    <main>
      <h1>{title}</h1>
      {children as ReactElement}
    </main>
  ),
}));
vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));
vi.mock("@/components/account/owner-data-export-section", () => ({
  OwnerDataExportSection: () => <section>Data export</section>,
}));

import AcceptTermsPage from "./page";

const user = { id: "user-1", email: "ada@example.com", name: "Ada" };
const updatedTerms: LegalDocument = {
  key: "terms_of_service",
  title: "Terms of Service",
  version: "0.2",
  effectiveDate: "2026-11-01",
  path: "docs/legal/terms-of-service.md",
  reacceptance: { changes: ["Fair-use limits are now stated in Eve turns."] },
};
const admitted = { admitted: true, status: "granted", profile: null };
const denied = { admitted: false, status: "denied", profile: null };

beforeEach(() => {
  vi.clearAllMocks();
  getLatestOwnerDataExportJob.mockResolvedValue(null);
  ownerHasExportableData.mockResolvedValue(true);
  getCurrentAccess.mockResolvedValue({
    state: "reacceptance",
    user,
    decision: admitted,
    documents: [updatedTerms],
  });
});

describe("the re-acceptance gate", () => {
  it("summarises what changed in each flagged document and asks for acceptance", async () => {
    const html = renderToStaticMarkup(await AcceptTermsPage());

    expect(html).toContain("Terms of Service");
    expect(html).toContain("Version 0.2");
    expect(html).toContain("November 1, 2026");
    expect(html).toContain("Fair-use limits are now stated in Eve turns.");
    expect(html).toContain("docs/legal/terms-of-service.md");
    // The form names the version it showed, so only that version is recorded.
    expect(html).toMatch(
      /name="terms_of_service"[^>]*value="0\.2"|value="0\.2"[^>]*name="terms_of_service"/,
    );
    expect(html).toContain("Accept and continue");
  });

  it("keeps export and sign-out reachable for a paying account, but not a Delete that would leave it billed", async () => {
    const html = renderToStaticMarkup(await AcceptTermsPage());

    expect(html).toContain("Data export");
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Delete account");
    expect(getLatestOwnerDataExportJob).toHaveBeenCalledWith("user-1");
  });

  it("offers a not-admitted account export, Delete, and Sign out without accepting", async () => {
    getCurrentAccess.mockResolvedValue({
      state: "reacceptance",
      user,
      decision: denied,
      documents: [updatedTerms],
    });

    const html = renderToStaticMarkup(await AcceptTermsPage());

    expect(html).toContain("Accept and continue");
    expect(html).toContain("Data export");
    expect(html).toContain("Delete account");
    expect(html).toContain("Sign out");
  });

  it("offers no export to an account that owns nothing to export", async () => {
    ownerHasExportableData.mockResolvedValue(false);

    const html = renderToStaticMarkup(await AcceptTermsPage());

    expect(html).not.toContain("Data export");
    expect(getLatestOwnerDataExportJob).not.toHaveBeenCalled();
  });

  it("sends an account that owes nothing back into the app", async () => {
    getCurrentAccess.mockResolvedValue({ state: "admitted", user, ownerUserId: "user-1" });

    await expect(AcceptTermsPage()).rejects.toThrow("REDIRECT:/");
  });

  it("sends a signed-out visitor to sign in", async () => {
    getCurrentAccess.mockResolvedValue({ state: "unauthenticated" });

    await expect(AcceptTermsPage()).rejects.toThrow("REDIRECT:/sign-in");
  });
});
