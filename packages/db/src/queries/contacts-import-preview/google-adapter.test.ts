import { describe, expect, it, vi } from "vitest";
import { createGoogleContactsAdapter } from "./google-adapter";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe("createGoogleContactsAdapter", () => {
  it("fetches personal contacts with the narrow display/email/phone/birthday field scope", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/v1/people/me/connections?");
      expect(url).toContain("personFields=names%2CemailAddresses%2CphoneNumbers%2Cbirthdays");
      expect(url).toContain("sources=READ_SOURCE_TYPE_CONTACT");
      expect(url).not.toContain("READ_SOURCE_TYPE_PROFILE");
      expect(url).not.toContain("organizations");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer token-abc");
      expect(url).not.toContain("token-abc");
      return jsonResponse({
        connections: [
          {
            resourceName: "people/c1",
            names: [{ displayName: "Mara Chen" }],
            emailAddresses: [{ value: "mara@example.com" }, { value: "mara@example.com" }],
            phoneNumbers: [{ value: "+1 312 555 0101" }],
            birthdays: [{ date: { year: 1990, month: 4, day: 18 } }],
            biographies: [{ value: "raw note" }],
          },
        ],
      });
    });
    const adapter = createGoogleContactsAdapter({
      getAccessToken: async () => "token-abc",
      fetchImpl,
      baseUrl: "https://people.test",
    });

    const contacts = await adapter.fetchContacts({ ownerUserId: "owner-1" });

    expect(contacts).toEqual([
      {
        providerContactId: "people/c1",
        displayName: "Mara Chen",
        emails: ["mara@example.com"],
        phones: ["+1 312 555 0101"],
        birthday: "--04-18",
      },
    ]);
    expect(Object.keys(contacts[0] ?? {})).toEqual([
      "providerContactId",
      "displayName",
      "emails",
      "phones",
      "birthday",
    ]);
  });

  it("falls back to email or phone display labels and drops rows without useful fields", async () => {
    const adapter = createGoogleContactsAdapter({
      getAccessToken: async () => "t",
      fetchImpl: async () =>
        jsonResponse({
          connections: [
            { resourceName: "people/email", emailAddresses: [{ value: "casey@example.com" }] },
            { resourceName: "people/phone", phoneNumbers: [{ value: "555-0100" }] },
            { resourceName: "people/empty" },
            { names: [{ displayName: "No id" }] },
          ],
        }),
    });

    await expect(adapter.fetchContacts({ ownerUserId: "owner-1" })).resolves.toEqual([
      {
        providerContactId: "people/email",
        displayName: "casey@example.com",
        emails: ["casey@example.com"],
        phones: [],
        birthday: null,
      },
      {
        providerContactId: "people/phone",
        displayName: "555-0100",
        emails: [],
        phones: ["555-0100"],
        birthday: null,
      },
    ]);
  });

  it("follows People API pagination tokens", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          connections: [{ resourceName: "people/one", names: [{ displayName: "One" }] }],
          nextPageToken: "next-page",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          connections: [{ resourceName: "people/two", names: [{ displayName: "Two" }] }],
        }),
      );
    const adapter = createGoogleContactsAdapter({
      getAccessToken: async () => "t",
      fetchImpl,
      baseUrl: "https://people.test",
    });

    await expect(adapter.fetchContacts({ ownerUserId: "owner-1" })).resolves.toMatchObject([
      { providerContactId: "people/one", displayName: "One" },
      { providerContactId: "people/two", displayName: "Two" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("pageToken=next-page");
  });

  it("throws a status-only error without token or raw payload details", async () => {
    const adapter = createGoogleContactsAdapter({
      getAccessToken: async () => "secret-token",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        json: async () => ({ secret: "payload" }),
      }),
    });

    await expect(adapter.fetchContacts({ ownerUserId: "owner-1" })).rejects.toThrow(/status 403/);
    await expect(adapter.fetchContacts({ ownerUserId: "owner-1" })).rejects.not.toThrow(
      /secret-token|payload/,
    );
  });
});
