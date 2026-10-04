import { describe, expect, it, vi } from "vitest";
import {
  createServiceHoldCheck,
  SERVICE_HOLD_REREAD_MS,
  serviceHoldResponse,
} from "./service-wide-hold-gate";
import { renderServiceHoldPage } from "./service-wide-hold-page";

const HOSTED = {
  TENDNOTE_ADMISSION_MODE: "hosted",
  TENDNOTE_STATUS_PAGE_URL: "https://status.example.com/",
};
const held = async () => true;
const open = async () => false;

function request(path: string, method = "GET") {
  return { method, url: `https://app.tendnote.com${path}` };
}

describe("serviceHoldResponse", () => {
  it("lets every request through while no hold is in force", async () => {
    await expect(serviceHoldResponse(request("/today"), open, HOSTED)).resolves.toBeNull();
  });

  it.each([
    "/",
    "/today",
    "/sign-in",
    "/api/auth/get-session",
    "/api/account/export",
    "/api/cron/background-jobs",
    "/api/queue/owner-data-export",
    "/api/resend/webhook",
    "/eve/v1/discord",
    "/api/stripe/webhook/other",
  ])("refuses %s while held", async (path) => {
    const response = await serviceHoldResponse(request(path), held, HOSTED);

    expect(response?.status).toBe(503);
    expect(response?.headers.get("retry-after")).toBe("300");
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps the Stripe webhook receiver answering, without reading the hold", async () => {
    const isHeld = vi.fn(held);

    await expect(
      serviceHoldResponse(request("/api/stripe/webhook", "POST"), isHeld, HOSTED),
    ).resolves.toBeNull();
    expect(isHeld).not.toHaveBeenCalled();
  });

  it("gives a navigation the static hold page linking the status page", async () => {
    const response = await serviceHoldResponse(request("/today"), held, HOSTED);

    expect(response?.headers.get("content-type")).toContain("text/html");
    const html = await response?.text();
    expect(html).toContain("Tendnote is offline for now");
    expect(html).toContain('href="https://status.example.com/"');
  });

  it("refuses a form post, Server Function, or API call with plain text", async () => {
    const response = await serviceHoldResponse(
      request("/api/account/delete", "POST"),
      held,
      HOSTED,
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get("content-type")).toContain("text/plain");
    await expect(response?.text()).resolves.toBe(
      "Tendnote is temporarily offline. Status: https://status.example.com/",
    );
  });

  it("is never in force on a self-hosted deployment", async () => {
    const isHeld = vi.fn(held);

    await expect(
      serviceHoldResponse(request("/today"), isHeld, {
        TENDNOTE_ADMISSION_MODE: "self-hosted",
        TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
      }),
    ).resolves.toBeNull();
    expect(isHeld).not.toHaveBeenCalled();
  });
});

describe("createServiceHoldCheck", () => {
  it("reads once per interval, sharing one read across concurrent requests", async () => {
    let time = 0;
    const read = vi.fn(held);
    const isHeld = createServiceHoldCheck({ read, now: () => time });

    await expect(Promise.all([isHeld(), isHeld()])).resolves.toEqual([true, true]);
    time += SERVICE_HOLD_REREAD_MS - 1;
    await isHeld();
    expect(read).toHaveBeenCalledTimes(1);

    time += 1;
    read.mockResolvedValueOnce(false);
    await expect(isHeld()).resolves.toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps the last answer when a read fails", async () => {
    let time = 0;
    const read = vi.fn(held);
    const logger = { error: vi.fn() };
    const isHeld = createServiceHoldCheck({ read, now: () => time, logger });
    await isHeld();

    time += SERVICE_HOLD_REREAD_MS;
    read.mockRejectedValueOnce(new Error("database unreachable"));

    await expect(isHeld()).resolves.toBe(true);
    expect(logger.error).toHaveBeenCalledWith("service_wide_hold.read_failed", {
      error: "database unreachable",
    });
  });

  it("keeps the last answer when a read is too slow", async () => {
    vi.useFakeTimers();
    try {
      const isHeld = createServiceHoldCheck({ read: () => new Promise(() => {}) });
      const answer = isHeld();
      await vi.advanceTimersByTimeAsync(1_500);
      await expect(answer).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("renderServiceHoldPage", () => {
  it("asks the visitor to try later when no status page is configured", () => {
    const html = renderServiceHoldPage(null);

    expect(html).toContain("Please try again in a little while.");
    expect(html).not.toContain("<a ");
  });

  it("links only an http(s) status page, escaped", () => {
    expect(renderServiceHoldPage("javascript:alert(1)")).not.toContain("<a ");
    expect(renderServiceHoldPage('https://status.example.com/?a="b"&c')).toContain(
      'href="https://status.example.com/?a=%22b%22&amp;c"',
    );
  });

  it("needs nothing the held product serves but the mark", () => {
    const html = renderServiceHoldPage(null);

    expect(html).not.toContain("<script");
    expect(html).not.toContain("/_next/");
    expect([...html.matchAll(/(?:src|srcset)="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "/icons/tendnote-mark-dark.png",
      "/icons/tendnote-mark-light.png",
    ]);
  });
});
