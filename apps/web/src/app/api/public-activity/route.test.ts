import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordPublicActivity } = vi.hoisted(() => ({
  recordPublicActivity: vi.fn(async () => {}),
}));
vi.mock("@tendnote/db/queries/public-activity", () => ({ recordPublicActivity }));

import { POST } from "./route";

const PAGE_VIEW = JSON.stringify({ event: "page_viewed", page: "pricing" });

function report(body: string, country?: string) {
  return new Request("https://app.tendnote.test/api/public-activity", {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      ...(country === undefined ? {} : { "x-vercel-ip-country": country }),
    },
    body,
  });
}

describe("POST /api/public-activity", () => {
  beforeEach(() => {
    vi.stubEnv("TENDNOTE_ADMISSION_MODE", "hosted");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    recordPublicActivity.mockClear();
  });

  it("counts a fixed event on a fixed page from a known-US hosted request", async () => {
    const response = await POST(report(PAGE_VIEW, "US"));

    expect(response.status).toBe(204);
    expect(recordPublicActivity).toHaveBeenCalledExactlyOnceWith({
      event: "page_viewed",
      page: "pricing",
    });
  });

  it("sets no cookie and returns no body", async () => {
    const response = await POST(report(PAGE_VIEW, "US"));

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it.each([
    ["another country", "CA"],
    ["a Region Block country", "DE"],
    ["an empty country", ""],
    ["an unknown country", undefined],
  ])("drops %s without saying so", async (_name, country) => {
    const response = await POST(report(PAGE_VIEW, country));

    expect(response.status).toBe(204);
    expect(recordPublicActivity).not.toHaveBeenCalled();
  });

  it.each([
    ["a raw URL", JSON.stringify({ event: "page_viewed", page: "/pricing?ref=newsletter" })],
    ["an unknown event", JSON.stringify({ event: "button_clicked", page: "home" })],
    ["malformed JSON", "page_viewed"],
  ])("ignores %s", async (_name, body) => {
    const response = await POST(report(body, "US"));

    expect(response.status).toBe(204);
    expect(recordPublicActivity).not.toHaveBeenCalled();
  });

  it("counts nothing on a self-hosted deployment, even from the US", async () => {
    vi.stubEnv("TENDNOTE_ADMISSION_MODE", "self-hosted");
    vi.stubEnv("TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL", "owner@example.com");

    await POST(report(PAGE_VIEW, "US"));

    expect(recordPublicActivity).not.toHaveBeenCalled();
  });
});
