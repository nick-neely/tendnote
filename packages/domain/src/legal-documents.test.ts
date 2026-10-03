import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_LEGAL_DOCUMENTS,
  clickwrapAcceptance,
  isCurrentClickwrapAcceptance,
  type LegalDocument,
  outstandingReacceptance,
} from "./legal-documents";

const repoRoot = join(import.meta.dirname, "../../..");

describe("hosted legal documents", () => {
  it.each(CURRENT_LEGAL_DOCUMENTS)("keeps $title's current version in the repository", (doc) => {
    const text = readFileSync(join(repoRoot, doc.path), "utf8");

    expect(text).toContain(`# Tendnote ${doc.title}`);
    expect(text).toMatch(
      new RegExp(`Version ${doc.version.replace(".", "\\.")}\\b.*${doc.effectiveDate}`),
    );
  });
});

describe("clickwrap acceptance", () => {
  it("accepts the current versions with the eligibility statement", () => {
    expect(isCurrentClickwrapAcceptance(clickwrapAcceptance())).toBe(true);
  });

  it("refuses a sign-up without the eligibility statement", () => {
    expect(isCurrentClickwrapAcceptance({ ...clickwrapAcceptance(), eligible: false })).toBe(false);
  });

  it("refuses a stale or missing document version", () => {
    const current = clickwrapAcceptance();

    expect(
      isCurrentClickwrapAcceptance({
        ...current,
        documents: { ...current.documents, terms_of_service: "0.0" },
      }),
    ).toBe(false);
    expect(
      isCurrentClickwrapAcceptance({ eligible: true, documents: { terms_of_service: "0.1" } }),
    ).toBe(false);
  });

  it.each([undefined, null, "yes", true, { eligible: true }])("refuses %j", (input) => {
    expect(isCurrentClickwrapAcceptance(input)).toBe(false);
  });
});

describe("re-acceptance", () => {
  const terms: LegalDocument = {
    key: "terms_of_service",
    title: "Terms of Service",
    version: "0.2",
    effectiveDate: "2026-11-01",
    path: "docs/legal/terms-of-service.md",
    reacceptance: { changes: ["Fair-use limits are now stated in Eve turns."] },
  };
  const privacy: LegalDocument = {
    key: "privacy_policy",
    title: "Privacy Policy",
    version: "0.2",
    effectiveDate: "2026-11-01",
    path: "docs/legal/privacy-policy.md",
  };

  it("owes a flagged version the account has not accepted", () => {
    expect(
      outstandingReacceptance(
        [{ documentKey: "terms_of_service", version: "0.1" }],
        [terms, privacy],
      ),
    ).toEqual([terms]);
  });

  it("owes a flagged version to an account with no Acceptance Records at all", () => {
    expect(outstandingReacceptance([], [terms, privacy])).toEqual([terms]);
  });

  it("owes nothing once the flagged version is accepted", () => {
    expect(
      outstandingReacceptance(
        [{ documentKey: "terms_of_service", version: "0.2" }],
        [terms, privacy],
      ),
    ).toEqual([]);
  });

  it("never gates on an unflagged version, accepted or not", () => {
    expect(outstandingReacceptance([], [privacy])).toEqual([]);
  });

  it("does not flag any launch version", () => {
    expect(CURRENT_LEGAL_DOCUMENTS.filter((doc) => doc.reacceptance)).toEqual([]);
  });
});
