import { describe, expect, it } from "vitest";
import type { GmailDraftAction } from "./gmail-drafts";
import {
  findLinkedGmailDraftAction,
  GOOGLE_GMAIL_COMPOSE_SCOPE,
  gmailDraftApprovalSchema,
  gmailDraftRecipientSchema,
  gmailDraftSubjectSchema,
  hasGmailComposeScope,
  isMimeHeaderSafe,
  suggestGmailSubject,
} from "./gmail-drafts";

function action(overrides: Partial<GmailDraftAction>): GmailDraftAction {
  return {
    id: "a",
    ownerUserId: "u",
    messageDraftId: "d",
    providerKey: "google",
    capabilityKey: "gmail",
    kind: "create",
    status: "succeeded",
    subject: "s",
    recipient: { email: "a@b.com", source: "manual_entry", contactMethodId: null },
    gmailDraftId: "g",
    version: 1,
    idempotencyKey: "k",
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("findLinkedGmailDraftAction", () => {
  it("returns the most recent succeeded action holding a Gmail draft id", () => {
    const linked = findLinkedGmailDraftAction([
      action({ id: "newest-failed", status: "failed", gmailDraftId: null }),
      action({ id: "succeeded", status: "succeeded", gmailDraftId: "g1" }),
    ]);
    expect(linked?.id).toBe("succeeded");
  });

  it("returns null when no succeeded action has a Gmail draft id", () => {
    expect(
      findLinkedGmailDraftAction([action({ status: "failed", gmailDraftId: null })]),
    ).toBeNull();
    expect(findLinkedGmailDraftAction([])).toBeNull();
  });
});

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

  it("rejects a subject carrying a line break or control character (MIME header injection)", () => {
    // A CRLF (or bare CR/LF) would terminate the `Subject:` line and inject an extra
    // header — a Bcc that could exfiltrate the body if the user later sends.
    expect(() => gmailDraftSubjectSchema.parse("Hi\r\nBcc: attacker@evil.example")).toThrow();
    expect(() => gmailDraftSubjectSchema.parse("Hi\nReply-To: attacker@evil.example")).toThrow();
    expect(() => gmailDraftSubjectSchema.parse("Hi\rCc: attacker@evil.example")).toThrow();
    // NUL and other C0 controls (and DEL) are likewise refused.
    expect(() => gmailDraftSubjectSchema.parse("Hi\x00there")).toThrow();
    expect(() => gmailDraftSubjectSchema.parse("Hi\x7fthere")).toThrow();
    // A plain subject with punctuation and accents is still accepted.
    expect(gmailDraftSubjectSchema.parse("¡Feliz cumpleaños, Casey!")).toBe(
      "¡Feliz cumpleaños, Casey!",
    );
  });
});

describe("isMimeHeaderSafe", () => {
  it("is true for a normal header value and false for control characters", () => {
    expect(isMimeHeaderSafe("Great catching up")).toBe(true);
    expect(isMimeHeaderSafe("¡Feliz cumpleaños!")).toBe(true);
    expect(isMimeHeaderSafe("x\r\ny")).toBe(false);
    expect(isMimeHeaderSafe("x\ny")).toBe(false);
    expect(isMimeHeaderSafe("x\x00y")).toBe(false);
  });
});

describe("gmailDraftApprovalSchema", () => {
  it("rejects an approval whose subject would inject a MIME header", () => {
    const parsed = gmailDraftApprovalSchema.safeParse({
      subject: "Hi\r\nBcc: attacker@evil.example",
      recipient: { email: "casey@example.com", source: "manual_entry", contactMethodId: null },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an approval whose recipient smuggles control characters", () => {
    const parsed = gmailDraftApprovalSchema.safeParse({
      subject: "Hi",
      recipient: {
        email: "casey@example.com\r\nBcc: attacker@evil.example",
        source: "manual_entry",
        contactMethodId: null,
      },
    });
    expect(parsed.success).toBe(false);
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
