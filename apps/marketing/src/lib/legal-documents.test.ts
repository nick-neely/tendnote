import { CURRENT_LEGAL_DOCUMENTS } from "@tendnote/domain/legal-documents";
import { describe, expect, it } from "vitest";
import {
  documentBody,
  formatEffectiveDate,
  loadLegalDocument,
  loadRepositoryDocument,
  RETENTION_TABLE_PATH,
  resolveDocumentHref,
  SUB_PROCESSORS_PATH,
  sourceRef,
} from "./legal-documents";

const BLOB = "https://github.com/nick-neely/tendnote/blob";

describe("links inside a legal document", () => {
  const doc = "docs/legal/privacy-policy.md";

  it("resolve relative links against the document's directory at the given ref", () => {
    expect(resolveDocumentHref("privacy-retention-table.md", doc, "abc123")).toBe(
      `${BLOB}/abc123/docs/legal/privacy-retention-table.md`,
    );
    expect(resolveDocumentHref("../support.md#hours", doc, "main")).toBe(
      `${BLOB}/main/docs/support.md#hours`,
    );
    expect(resolveDocumentHref("/LICENSE", doc, "main")).toBe(`${BLOB}/main/LICENSE`);
  });

  it("leave absolute links and in-page fragments alone", () => {
    const issue = "https://github.com/nick-neely/tendnote/issues/658";
    expect(resolveDocumentHref(issue, doc, "main")).toBe(issue);
    expect(resolveDocumentHref("mailto:support@example.com", doc, "main")).toBe(
      "mailto:support@example.com",
    );
    expect(resolveDocumentHref("#retention", doc, "main")).toBe("#retention");
  });

  it("point at the deployed commit, or main when there is none", () => {
    expect(sourceRef({ VERCEL_GIT_COMMIT_SHA: "abc123" })).toBe("abc123");
    expect(sourceRef({})).toBe("main");
  });
});

describe("document bodies", () => {
  it("drop generator comments and the document's own title", () => {
    expect(documentBody("<!-- generated -->\n\n# Retention\n\n| a | b |\n")).toBe("| a | b |");
    expect(documentBody("Text with no title.\n")).toBe("Text with no title.");
  });

  it("show effective dates in words, whatever the machine's time zone", () => {
    expect(formatEffectiveDate("2026-09-27")).toBe("September 27, 2026");
  });
});

describe("the repository's legal documents", () => {
  it.each(CURRENT_LEGAL_DOCUMENTS)("load $title at version $version", async (current) => {
    const loaded = await loadLegalDocument(current.key);
    expect(loaded).toMatchObject({
      title: current.title,
      version: current.version,
      path: current.path,
    });
    expect(loaded.body).not.toMatch(/^# /m);
    expect(loaded.body).toContain(`Version ${current.version}`);
  });

  it("include the retention table and the sub-processor list", async () => {
    const retention = await loadRepositoryDocument(RETENTION_TABLE_PATH);
    expect(retention.body).toMatch(/^\| Data \| Retained \|/);
    expect(retention.body).not.toContain("<!--");

    const subProcessors = await loadRepositoryDocument(SUB_PROCESSORS_PATH);
    expect(subProcessors.body).toMatch(/\| Sub-processor \| Purpose \|/);
  });
});
