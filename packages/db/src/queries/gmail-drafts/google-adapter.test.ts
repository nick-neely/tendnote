import { describe, expect, it, vi } from "vitest";
import { createGoogleGmailDraftAdapter } from "./google-adapter";

const OWNER = "user-1";

function decodeRaw(rawBase64Url: string): string {
  return Buffer.from(rawBase64Url, "base64url").toString("utf8");
}

/** A fake fetch that records the request and returns a fixed drafts response. */
function fakeFetch(response: { ok?: boolean; status?: number; body?: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body ?? { id: "gmail-draft-1" },
    };
  });
  return { impl, calls };
}

describe("Google Gmail draft adapter", () => {
  it("creates a draft with a minimized to/subject/body message and only the draft id back", async () => {
    const { impl, calls } = fakeFetch({ body: { id: "gmail-draft-1", message: { id: "m-1" } } });
    const adapter = createGoogleGmailDraftAdapter({
      getAccessToken: async () => "token-abc",
      fetchImpl: impl,
      baseUrl: "https://gmail.test/gmail/v1",
    });

    const result = await adapter.createDraft({
      ownerUserId: OWNER,
      to: "casey@example.com",
      subject: "Great catching up",
      body: "Hey Casey, good to reconnect.",
    });

    expect(result).toEqual({ gmailDraftId: "gmail-draft-1" });
    const call = calls[0];
    expect(call?.url).toBe("https://gmail.test/gmail/v1/users/me/drafts");
    expect(call?.init?.method).toBe("POST");
    // The access token is sent as a bearer header, never in the URL.
    expect((call?.init?.headers as Record<string, string> | undefined)?.authorization).toBe(
      "Bearer token-abc",
    );
    expect(call?.url).not.toContain("token-abc");

    const payload = JSON.parse(String(call?.init?.body)) as { message: { raw: string } };
    const raw = decodeRaw(payload.message.raw);
    expect(raw).toContain("To: casey@example.com");
    expect(raw).toContain("Subject: Great catching up");
    expect(raw).toContain("Hey Casey, good to reconnect.");
    // First slice is to/subject/body only — no CC, BCC, or attachments (ADR-0095).
    expect(raw).not.toMatch(/^Cc:/im);
    expect(raw).not.toMatch(/^Bcc:/im);
    expect(raw).not.toContain("attachment");
  });

  it("updates an existing draft in place by its Gmail draft id", async () => {
    const { impl, calls } = fakeFetch({ body: { id: "gmail-draft-1" } });
    const adapter = createGoogleGmailDraftAdapter({
      getAccessToken: async () => "token-abc",
      fetchImpl: impl,
      baseUrl: "https://gmail.test/gmail/v1",
    });

    await adapter.updateDraft({
      ownerUserId: OWNER,
      to: "casey@example.com",
      subject: "Revised",
      body: "Updated body.",
      gmailDraftId: "gmail-draft-1",
    });

    expect(calls[0]?.url).toBe("https://gmail.test/gmail/v1/users/me/drafts/gmail-draft-1");
    expect(calls[0]?.init?.method).toBe("PUT");
  });

  it("exposes no send/read/list method — only draft create and update (ADR-0089)", () => {
    const adapter = createGoogleGmailDraftAdapter({ getAccessToken: async () => "t" });
    expect(Object.keys(adapter).sort()).toEqual(["createDraft", "updateDraft"]);
  });

  it("throws a status-only error (no token, no payload) on a failed write", async () => {
    const { impl } = fakeFetch({ ok: false, status: 503 });
    const adapter = createGoogleGmailDraftAdapter({
      getAccessToken: async () => "token-abc",
      fetchImpl: impl,
      baseUrl: "https://gmail.test/gmail/v1",
    });

    await expect(
      adapter.createDraft({ ownerUserId: OWNER, to: "a@b.com", subject: "s", body: "b" }),
    ).rejects.toThrow(/status 503/);
  });

  it("RFC 2047-encodes a non-ASCII subject", async () => {
    const { impl, calls } = fakeFetch({ body: { id: "d" } });
    const adapter = createGoogleGmailDraftAdapter({
      getAccessToken: async () => "t",
      fetchImpl: impl,
      baseUrl: "https://gmail.test/gmail/v1",
    });

    await adapter.createDraft({
      ownerUserId: OWNER,
      to: "a@b.com",
      subject: "¡Feliz cumpleaños!",
      body: "b",
    });
    const raw = decodeRaw(
      (JSON.parse(String(calls[0]?.init?.body)) as { message: { raw: string } }).message.raw,
    );
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("splits a long non-ASCII subject into RFC 2047 encoded-words each within the 75-char limit", async () => {
    const { impl, calls } = fakeFetch({ body: { id: "d" } });
    const adapter = createGoogleGmailDraftAdapter({
      getAccessToken: async () => "t",
      fetchImpl: impl,
      baseUrl: "https://gmail.test/gmail/v1",
    });

    // A previously mishandled case: a long accented subject produced ONE ~1300-char
    // encoded-word, exceeding RFC 2047's 75-char limit. It must now fold.
    const subject = "Feliz cumpleaños ".repeat(40).trim();
    await adapter.createDraft({ ownerUserId: OWNER, to: "a@b.com", subject, body: "b" });
    const raw = decodeRaw(
      (JSON.parse(String(calls[0]?.init?.body)) as { message: { raw: string } }).message.raw,
    );

    // Every encoded-word stays within the RFC 2047 limit, and decoding the words
    // reconstructs the original subject exactly.
    const words = raw.match(/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/g) ?? [];
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) {
      expect(word.length).toBeLessThanOrEqual(75);
    }
    const decoded = words
      .map((w) =>
        Buffer.from(w.slice("=?UTF-8?B?".length, -"?=".length), "base64").toString("utf8"),
      )
      .join("");
    expect(decoded).toBe(subject);
  });

  it("refuses a subject that carries a CRLF, so no header can be injected", async () => {
    const { impl, calls } = fakeFetch({ body: { id: "d" } });
    const adapter = createGoogleGmailDraftAdapter({
      getAccessToken: async () => "t",
      fetchImpl: impl,
      baseUrl: "https://gmail.test/gmail/v1",
    });

    await expect(
      adapter.createDraft({
        ownerUserId: OWNER,
        to: "a@b.com",
        subject: "Hi\r\nBcc: attacker@evil.example\r\nReply-To: attacker@evil.example",
        body: "secret body",
      }),
    ).rejects.toThrow(/control character/i);
    // The write never reached the provider — no draft with injected headers exists.
    expect(calls).toHaveLength(0);
  });

  it("refuses a recipient that carries a CRLF, so no header can be injected", async () => {
    const { impl, calls } = fakeFetch({ body: { id: "d" } });
    const adapter = createGoogleGmailDraftAdapter({
      getAccessToken: async () => "t",
      fetchImpl: impl,
      baseUrl: "https://gmail.test/gmail/v1",
    });

    await expect(
      adapter.updateDraft({
        ownerUserId: OWNER,
        to: "a@b.com\r\nBcc: attacker@evil.example",
        subject: "Hi",
        body: "secret body",
        gmailDraftId: "gmail-draft-1",
      }),
    ).rejects.toThrow(/control character/i);
    expect(calls).toHaveLength(0);
  });
});
