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
vi.mock("@/app/actions/contact-import", () => ({
  confirmContactImportCandidateAction: vi.fn(),
  confirmSafeContactImportCandidatesAction: vi.fn(),
}));

import ContactsImportPage from "./page";

beforeEach(() => {
  getOwnerContactImportPreview.mockReset();
});

describe("ContactsImportPage", () => {
  it("renders a unified table with resolution controls per review state", async () => {
    getOwnerContactImportPreview.mockResolvedValue({
      id: "session-1",
      connected: true,
      mode: "prioritized",
      query: "",
      fetchedCount: 3,
      shownCount: 3,
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
          advisoryMatches: [],
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
          advisoryMatches: [],
          conflicts: [{ type: "birthday", message: "Tendnote already has birthday --04-18." }],
          matchedPerson: { id: "person-conflict", displayName: "Conflict Contact" },
        },
        {
          id: "new",
          displayName: "New Contact",
          providerContactId: "people/new",
          emails: ["new@example.com"],
          phones: [],
          birthday: null,
          priority: "useful_email",
          score: 20,
          reasons: ["Includes an email address"],
          reviewState: "individual_review",
          safeBulkEligible: false,
          matchSignals: [],
          advisoryMatches: [],
          conflicts: [],
          matchedPerson: null,
        },
      ],
    });

    const html = renderToStaticMarkup(await ContactsImportPage());

    // Unified table + toolbar rather than the old split sections + banner.
    expect(html).toContain("Confirm safe recommendations");
    expect(html).toContain("Filter by name, email, or phone");
    // Every candidate shares one table.
    expect(html).toContain("Safe Contact");
    expect(html).toContain("Conflict Contact");
    expect(html).toContain("New Contact");
    expect(html).toContain("Matches Conflict Contact");
    // Inline resolution zone (rendered collapsed) per review state.
    expect(html).toContain("Apply resolution");
    expect(html).toContain("Create new person");
    expect(html).toContain("Skip");
    expect(html).toContain("Tendnote already has birthday --04-18.");
    // Summary line reflects the full fetched set, not the old 3-cap copy.
    expect(html).toContain("fetched from Google");
  });

  it("renders a calm empty state when nothing was fetched", async () => {
    getOwnerContactImportPreview.mockResolvedValue({
      id: "session-1",
      connected: true,
      mode: "prioritized",
      query: "",
      fetchedCount: 0,
      shownCount: 0,
      hiddenCount: 0,
      candidates: [],
    });

    const html = renderToStaticMarkup(await ContactsImportPage());

    expect(html).toContain("No contacts were fetched from Google.");
  });

  it("renders advisory fuzzy match reasons with a target chooser", async () => {
    getOwnerContactImportPreview.mockResolvedValue({
      id: "session-1",
      connected: true,
      mode: "prioritized",
      query: "",
      fetchedCount: 1,
      shownCount: 1,
      hiddenCount: 0,
      candidates: [
        {
          id: "fuzzy",
          displayName: "M Chen",
          providerContactId: "people/fuzzy",
          emails: ["mchen@example.com"],
          phones: [],
          birthday: null,
          priority: "useful_email",
          score: 65,
          reasons: ["Possible match: Mara Chen", "Includes an email address"],
          reviewState: "advisory_match",
          safeBulkEligible: false,
          matchSignals: [],
          advisoryMatches: [
            {
              personId: "person-mara",
              displayName: "Mara Chen",
              confidence: "high",
              reason: "Similar name and shared email initials",
            },
          ],
          conflicts: [],
          matchedPerson: null,
        },
      ],
    });

    const html = renderToStaticMarkup(await ContactsImportPage());

    expect(html).toContain("Advisory");
    expect(html).toContain("Choose target person");
    expect(html).toContain("Advisory: Mara Chen");
    expect(html).toContain("Similar name and shared email initials");
  });
});
