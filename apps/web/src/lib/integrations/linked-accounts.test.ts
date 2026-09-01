import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { findLinkedAccountRowId } = await import("./linked-accounts");

const HEADERS = new Headers();

function reader(accounts: ReadonlyArray<Record<string, unknown>>) {
  return {
    api: { listUserAccounts: async () => accounts },
  } as unknown as Parameters<typeof findLinkedAccountRowId>[0];
}

function account(id: string, providerId: string, accountId: string, createdAt: string) {
  return { id, providerId, accountId, createdAt: new Date(createdAt) };
}

/**
 * Better Auth keys a link by its provider-side account id, so linking a second
 * Google account adds a row rather than replacing the first, and
 * `accountLinking.allowDifferentEmails` permits exactly that. Every assertion
 * below is about which of two same-provider rows this seam names.
 */
describe("findLinkedAccountRowId", () => {
  it("returns the row id for the owner's linked provider", async () => {
    const auth = reader([account("acct-1", "google", "google-user-1", "2026-01-01")]);
    await expect(findLinkedAccountRowId(auth, HEADERS, "google")).resolves.toBe("acct-1");
  });

  it("returns null when the provider is not linked", async () => {
    const auth = reader([account("acct-1", "discord", "discord-user-1", "2026-01-01")]);
    await expect(findLinkedAccountRowId(auth, HEADERS, "google")).resolves.toBeNull();
  });

  it("names the exact row when the caller knows the provider-side account", async () => {
    const auth = reader([
      account("acct-first", "discord", "111", "2026-01-01"),
      account("acct-second", "discord", "222", "2026-02-01"),
    ]);
    await expect(findLinkedAccountRowId(auth, HEADERS, "discord", "222")).resolves.toBe(
      "acct-second",
    );
  });

  it("falls back to the provider match when the named account is not linked", async () => {
    const auth = reader([account("acct-first", "discord", "111", "2026-01-01")]);
    await expect(findLinkedAccountRowId(auth, HEADERS, "discord", "999")).resolves.toBe(
      "acct-first",
    );
  });

  it("takes the oldest link rather than whichever row was listed first", async () => {
    const newestFirst = reader([
      account("acct-new", "google", "google-user-2", "2026-06-01"),
      account("acct-old", "google", "google-user-1", "2026-01-01"),
    ]);
    const oldestFirst = reader([
      account("acct-old", "google", "google-user-1", "2026-01-01"),
      account("acct-new", "google", "google-user-2", "2026-06-01"),
    ]);

    // The same owner, the same two links, two listing orders: one answer.
    await expect(findLinkedAccountRowId(newestFirst, HEADERS, "google")).resolves.toBe("acct-old");
    await expect(findLinkedAccountRowId(oldestFirst, HEADERS, "google")).resolves.toBe("acct-old");
  });

  it("breaks a same-timestamp tie by row id so the answer stays total", async () => {
    const auth = reader([
      account("acct-b", "google", "google-user-2", "2026-01-01"),
      account("acct-a", "google", "google-user-1", "2026-01-01"),
    ]);
    await expect(findLinkedAccountRowId(auth, HEADERS, "google")).resolves.toBe("acct-a");
  });
});
