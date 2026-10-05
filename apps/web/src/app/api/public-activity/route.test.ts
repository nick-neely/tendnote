import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordPublicActivity } = vi.hoisted(() => ({
  recordPublicActivity: vi.fn(async () => {}),
}));
vi.mock("@tendnote/db/queries/public-activity", () => ({ recordPublicActivity }));

import { PUBLIC_ACTIVITY_EVENTS, PUBLIC_PAGES } from "@tendnote/domain/public-activity";
import { POST } from "./route";

const PAGE_VIEW = JSON.stringify({ event: "page_viewed", page: "pricing" });

/** A body that hands out `chunk` until `total` bytes, counting how much was pulled. */
function streamedBody(chunk: string, total: number) {
  const bytes = new TextEncoder().encode(chunk);
  const pulled = { bytes: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.bytes >= total) {
        controller.close();
        return;
      }
      pulled.bytes += bytes.byteLength;
      controller.enqueue(bytes);
    },
  });
  return { stream, pulled };
}

function request(body: BodyInit, headers: Record<string, string>) {
  return new Request("https://app.tendnote.test/api/public-activity", {
    method: "POST",
    headers: { "content-type": "text/plain", ...headers },
    body,
    duplex: "half",
  } as RequestInit);
}

function streamedReport(stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return request(stream, { "x-vercel-ip-country": "US", ...headers });
}

function report(body: string, country?: string) {
  return request(body, country === undefined ? {} : { "x-vercel-ip-country": country });
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

  it("ignores a body too large to be a report", async () => {
    const oversized = JSON.stringify({
      event: "page_viewed",
      page: "pricing",
      pad: "x".repeat(512),
    });

    const response = await POST(report(oversized, "US"));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(recordPublicActivity).not.toHaveBeenCalled();
  });

  it("refuses a declared oversized body without reading it", async () => {
    const { stream } = streamedBody("x".repeat(64), 1_000_000);
    const oversized = streamedReport(stream, { "content-length": "1000000" });

    const response = await POST(oversized);

    expect(response.status).toBe(204);
    expect(recordPublicActivity).not.toHaveBeenCalled();
    expect(oversized.bodyUsed).toBe(false);
  });

  it("stops reading an undeclared body once it passes the cap", async () => {
    const { stream, pulled } = streamedBody("x".repeat(64), 1_000_000);

    const response = await POST(streamedReport(stream));

    expect(response.status).toBe(204);
    expect(recordPublicActivity).not.toHaveBeenCalled();
    expect(pulled.bytes).toBeLessThan(1024);
  });

  it("drops a body that fails mid-read without saying so", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(PAGE_VIEW.slice(0, 10)));
        controller.error(new Error("client went away"));
      },
    });

    const response = await POST(streamedReport(stream));

    expect(response.status).toBe(204);
    expect(recordPublicActivity).not.toHaveBeenCalled();
  });

  it("fits the longest valid report under the cap", async () => {
    const longest = PUBLIC_ACTIVITY_EVENTS.flatMap((event) =>
      PUBLIC_PAGES.map((page) => ({ event, page })),
    ).reduce((a, b) => (JSON.stringify(b).length > JSON.stringify(a).length ? b : a));

    await POST(report(JSON.stringify(longest), "US"));

    expect(recordPublicActivity).toHaveBeenCalledExactlyOnceWith(longest);
  });

  it("counts a valid report that arrives in pieces", async () => {
    const bytes = new TextEncoder().encode(PAGE_VIEW);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10));
        controller.enqueue(bytes.slice(10));
        controller.close();
      },
    });

    const response = await POST(streamedReport(stream));

    expect(response.status).toBe(204);
    expect(recordPublicActivity).toHaveBeenCalledExactlyOnceWith({
      event: "page_viewed",
      page: "pricing",
    });
  });

  it("counts nothing on a self-hosted deployment, even from the US", async () => {
    vi.stubEnv("TENDNOTE_ADMISSION_MODE", "self-hosted");
    vi.stubEnv("TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL", "owner@example.com");

    await POST(report(PAGE_VIEW, "US"));

    expect(recordPublicActivity).not.toHaveBeenCalled();
  });
});
