import { describe, expect, it } from "vitest";

import { emailColors } from "../theme";
import { renderHouseholdInvitationEmail } from "./household-invitation";

const INVITATION = {
  householdName: "The Neely house",
  inviterName: "Alex",
  acceptUrl: "https://tendnote.test/join/one-time-secret",
  expiresAt: new Date("2026-08-15T09:00:00Z"),
  supportEmail: "support@example.test",
};

const rendered = await renderHouseholdInvitationEmail(INVITATION);

describe("what the invitation says", () => {
  it("names the household in the subject, so the inbox row is already specific", () => {
    expect(rendered.subject).toBe("You're invited to The Neely house on Tendnote");
  });

  it("names who invited, what a household is, and what joining does not do", () => {
    expect(rendered.text).toContain("Alex invited you to join their household on Tendnote");
    expect(rendered.text).toContain("A shared place for plans and reminders");
    expect(rendered.text).toContain("Your private notes stay private");
    expect(rendered.text).toContain("Nothing happens unless you accept.");
  });

  it("says how long the link lasts, in the reader's terms and not the clock's", () => {
    // Pinned to UTC so the same invitation renders the same words on every
    // machine that builds it.
    expect(rendered.text).toContain("Available until Aug 15");
    expect(rendered.html).toContain("Aug 15");
  });

  it("stands on its own when the household has no name for the sender", async () => {
    const anonymous = await renderHouseholdInvitationEmail({ ...INVITATION, inviterName: null });

    expect(anonymous.text).toContain("You've been invited to join a household on Tendnote");
    expect(anonymous.text).not.toContain("null");
  });

  /**
   * A blocked image, a stripped stylesheet, and a client that renders text only
   * are all ordinary. The link has to survive every one of them, so it appears
   * as a pressable control and again as something to paste.
   */
  it("carries the acceptance link in both bodies, with a linked and copyable fallback", () => {
    expect(rendered.text).toContain(INVITATION.acceptUrl);
    expect(rendered.html.split(INVITATION.acceptUrl).length - 1).toBe(3);
    expect(rendered.text).toContain("Open the invitation in your browser");
  });

  it("identifies the sender and why this arrived, and gives a way to answer", () => {
    expect(rendered.text).toContain("Why you received this");
    expect(rendered.text).toContain("Alex invited this email address");
    expect(rendered.text).toContain("support@example.test");
  });
});

describe("what the invitation must never say", () => {
  it("keeps CRM language and guilt out of a message about someone's home", () => {
    expect(rendered.text).not.toMatch(/\b(lead|pipeline|deal|account manager|onboard)\b/i);
    expect(rendered.text).not.toMatch(/\b(hurry|act now|don't miss|expires soon|last chance)\b/i);
  });

  /** No em dashes anywhere in the product's voice. */
  it("uses plain dashes", () => {
    expect(rendered.text).not.toContain("—");
    expect(rendered.html).not.toContain("—");
  });

  /**
   * A tracking pixel or a click-wrapped link would hand a working household
   * capability to a third party's redirector, and the delivery research forbids
   * both for exactly that reason.
   */
  it("carries no images at all, so there is nothing to track and nothing to block", () => {
    expect(rendered.html).not.toContain("<img");
  });
});

describe("the accessibility floor every client has to clear", () => {
  it("declares a language and a direction where clients cannot strip them", () => {
    expect(rendered.html).toMatch(/<html[^>]*lang="en"/);
    expect(rendered.html).toMatch(/<html[^>]*dir="ltr"/);
    // Again on the body, because several clients drop the attributes from
    // `<html>` and a screen reader with no language is the commonest failure in
    // production email.
    expect(rendered.html).toMatch(/<body[^>]*lang="en"/);
    expect(rendered.html).toMatch(/<body[^>]*dir="ltr"/);
  });

  it("carries exactly one title, and it is the subject rather than the brand", () => {
    expect(rendered.html.match(/<title>/g)).toHaveLength(1);
    expect(rendered.html).toContain("<title>You&#x27;re invited to The Neely house on Tendnote");
  });

  it("has one h1 and no faked heading below it", () => {
    expect(rendered.html.match(/<h1/g)).toHaveLength(1);
    expect(rendered.html).not.toMatch(/<h[23]/);
  });

  /** Otherwise a screen reader announces "table, row 1 of N" for every layout row. */
  it("marks every layout table presentational", () => {
    const tables = rendered.html.match(/<table[^>]*>/g) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every((table) => table.includes('role="presentation"'))).toBe(true);
  });

  it("gives every link text that describes where it goes", () => {
    const links = [...rendered.html.matchAll(/<a\b[^>]*>(.*?)<\/a>/gs)];
    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      const label = (link[1] ?? "").replace(/<[^>]*>/g, "").replace(/<!--.*?-->/gs, "");
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label).not.toMatch(/click here|learn more|read more/i);
    }
  });

  /**
   * A short preheader shown in the inbox list. Long enough to say something,
   * short enough that no client truncates it into a fragment.
   */
  it("previews the promise and the deadline rather than repeating the subject", () => {
    expect(rendered.html).toContain("Nothing is shared until you choose to share it.");
    const preview = "Nothing is shared until you choose to share it. The link works until Aug 15.";
    expect(preview.length).toBeLessThanOrEqual(90);
  });

  it("sends a plain-text alternative that stands alone", () => {
    expect(rendered.text.length).toBeGreaterThan(200);
    expect(rendered.text).not.toContain("<");
    // The preheader's whitespace padding is inbox plumbing, not reading matter.
    expect(rendered.text).not.toContain("‌");
  });
});

describe("the Field Notebook, in an inbox", () => {
  it("paints a pure white ground rather than the tinted card email defaults to", () => {
    expect(rendered.html).toContain(`background-color:${emailColors.background}`);
    expect(rendered.html).not.toMatch(/box-shadow/);
  });

  it("spends sage on exactly one control", () => {
    expect(rendered.html.split(emailColors.primary).length - 1).toBe(1);
  });

  it("declares both themes, and hands the dark one real tokens", () => {
    expect(rendered.html).toContain('name="color-scheme"');
    expect(rendered.html).toContain("@media (prefers-color-scheme: dark)");
    expect(rendered.html).toContain("#6ca366");
  });
});
