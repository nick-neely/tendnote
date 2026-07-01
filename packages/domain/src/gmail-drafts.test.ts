import { describe, expect, it } from "vitest";
import {
  GOOGLE_GMAIL_COMPOSE_SCOPE,
  gmailDraftRecipientSchema,
  gmailDraftSubjectSchema,
  hasGmailComposeScope,
  suggestGmailSubject,
} from "./gmail-drafts";

describe("Gmail draft-write scope", () => {
  it("detects the compose scope", () => {
    expect(hasGmailComposeScope(["email", GOOGLE_GMAIL_COMPOSE_SCOPE])).toBe(true);
    expect(hasGmailComposeScope(["email"])).toBe(false);
  });
});

describe("gmailDraftRecipientSchema", () => {
  it("accepts a saved contact-method recipient with a method id", () => {
    const parsed = gmailDraftRecipientSchema.parse({
      email: "casey@example.com",
      source: "contact_method",
      contactMethodId: "cm-1",
    });
    expect(parsed.contactMethodId).toBe("cm-1");
  });

  it("accepts a manual entry and defaults its contact-method id to null", () => {
    const parsed = gmailDraftRecipientSchema.parse({
      email: "casey@example.com",
      source: "manual_entry",
    });
    expect(parsed.contactMethodId).toBeNull();
  });

  it("rejects a manual entry that smuggles a contact-method id (no silent enrichment)", () => {
    expect(() =>
      gmailDraftRecipientSchema.parse({
        email: "casey@example.com",
        source: "manual_entry",
        contactMethodId: "cm-1",
      }),
    ).toThrow();
  });

  it("rejects an invalid email address", () => {
    expect(() =>
      gmailDraftRecipientSchema.parse({ email: "not-an-email", source: "manual_entry" }),
    ).toThrow();
  });
});

describe("gmailDraftSubjectSchema", () => {
  it("requires a non-empty subject", () => {
    expect(() => gmailDraftSubjectSchema.parse("   ")).toThrow();
    expect(gmailDraftSubjectSchema.parse("  Catching up  ")).toBe("Catching up");
  });
});

describe("suggestGmailSubject", () => {
  it("frames the known purpose with the person's name, inventing no facts", () => {
    expect(suggestGmailSubject({ purpose: "birthday", personName: "Casey" })).toBe(
      "Happy birthday, Casey!",
    );
    expect(suggestGmailSubject({ purpose: "thank_you", personName: "Casey" })).toBe(
      "Thank you, Casey",
    );
    expect(suggestGmailSubject({ purpose: "check_in", personName: "Casey" })).toBe(
      "Checking in, Casey",
    );
    expect(suggestGmailSubject({ purpose: "other", personName: "Casey" })).toBe("Hello, Casey");
  });

  it("is deterministic and degrades gracefully without a name", () => {
    expect(suggestGmailSubject({ purpose: "birthday", personName: null })).toBe("Happy birthday!");
    expect(suggestGmailSubject({ purpose: "check_in" })).toBe("Checking in");
  });
});
