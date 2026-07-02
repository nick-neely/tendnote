import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOwnerContactImportPreview } = vi.hoisted(() => ({
  getOwnerContactImportPreview: vi.fn(),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/integrations/contact-import-preview-data", () => ({
  getOwnerContactImportPreview,
}));

import ContactsImportPage from "./page";

beforeEach(() => {
  getOwnerContactImportPreview.mockReset();
});

describe("ContactsImportPage", () => {
  it("separates safe recommendations from individual-review candidates", async () => {
    getOwnerContactImportPreview.mockResolvedValue({
      id: "session-1",
      connected: true,
      mode: "prioritized",
      query: "",
      fetchedCount: 2,
      shownCount: 2,
      hiddenCount: 0,
      candidates: [
        {
          id: "safe",
          displayName: "Safe Contact",
          providerContactId: "people/safe",
          emails: ["safe@example.com"],
          phones: [],
          birthday: null,
          priority: "existing_person_match",
          score: 120,
          reasons: ["Matches Safe Contact by saved contact method"],
          reviewState: "safe_recommendation",
          safeBulkEligible: true,
          matchSignals: [
            {
              type: "email",
              value: "safe@example.com",
              confidence: "strong",
              matchedPersonId: "person-safe",
            },
          ],
          conflicts: [],
          matchedPerson: { id: "person-safe", displayName: "Safe Contact" },
        },
        {
          id: "conflict",
          displayName: "Conflict Contact",
          providerContactId: "people/conflict",
          emails: ["conflict@example.com"],
          phones: [],
          birthday: "--05-20",
          priority: "existing_person_match",
          score: 120,
          reasons: ["Matches Conflict Contact by saved contact method"],
          reviewState: "conflict",
          safeBulkEligible: false,
          matchSignals: [
            {
              type: "email",
              value: "conflict@example.com",
              confidence: "strong",
              matchedPersonId: "person-conflict",
            },
          ],
          conflicts: [{ type: "birthday", message: "Tendnote already has birthday --04-18." }],
          matchedPerson: { id: "person-conflict", displayName: "Conflict Contact" },
        },
      ],
    });

    const html = renderToStaticMarkup(
      await ContactsImportPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Safe recommendations");
    expect(html).toContain("Needs individual review");
    expect(html).toContain("Safe Contact");
    expect(html).toContain("Conflict Contact");
    expect(html).toContain("Tendnote already has birthday --04-18.");
  });
});
