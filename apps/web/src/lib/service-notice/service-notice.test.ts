import { describe, expect, it, vi } from "vitest";
import { fetchServiceNotice } from "./service-notice";

const STATUS_URL = "https://status.example.com/tendnote";
const NOTICE = { message: "Reminders are delivering late.", updatedAt: "2026-10-01T15:00:00.000Z" };

function respondWith(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => Response.json(body, { status }));
}

describe("Service Notice banner source", () => {
  it("reads the notice the status page publishes", async () => {
    const fetchImpl = respondWith({ notice: NOTICE });

    await expect(fetchServiceNotice(STATUS_URL, fetchImpl)).resolves.toEqual(NOTICE);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`${STATUS_URL}/notice.json`);
  });

  it("shows nothing when no notice is posted", async () => {
    await expect(fetchServiceNotice(STATUS_URL, respondWith({ notice: null }))).resolves.toBeNull();
  });

  it("shows nothing when no status page is configured", async () => {
    const fetchImpl = respondWith({ notice: NOTICE });

    await expect(fetchServiceNotice(undefined, fetchImpl)).resolves.toBeNull();
    await expect(fetchServiceNotice("  ", fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["an error status", respondWith({ notice: NOTICE }, 503)],
    ["a malformed file", respondWith({ notice: { message: "" } })],
    [
      "an unreachable host",
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("fetch failed");
      }),
    ],
  ])("shows nothing for %s", async (_case, fetchImpl) => {
    await expect(fetchServiceNotice(STATUS_URL, fetchImpl)).resolves.toBeNull();
  });
});
