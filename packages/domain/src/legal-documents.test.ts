import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_LEGAL_DOCUMENTS,
  currentClickwrapAcceptance,
  isCurrentClickwrapAcceptance,
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
    expect(isCurrentClickwrapAcceptance(currentClickwrapAcceptance())).toBe(true);
  });

  it("refuses a sign-up without the eligibility statement", () => {
    expect(isCurrentClickwrapAcceptance({ ...currentClickwrapAcceptance(), eligible: false })).toBe(
      false,
    );
  });

  it("refuses a stale or missing document version", () => {
    const current = currentClickwrapAcceptance();

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
