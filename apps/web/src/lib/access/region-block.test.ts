import { describe, expect, it } from "vitest";
import { REGION_PAGE_PATH, regionBlockResponse } from "./region-block";

const HOSTED = { TENDNOTE_ADMISSION_MODE: "hosted" };
const SELF_HOSTED = {
  TENDNOTE_ADMISSION_MODE: "self-hosted",
  TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
};

function request(path: string, country?: string, method = "GET") {
  const headers = new Headers();
  if (country !== undefined) headers.set("x-vercel-ip-country", country);
  return { method, url: `https://app.tendnote.com${path}`, headers };
}

describe("hosted Region Block", () => {
  it.each(["/sign-up", "/sign-in", "/", "/people", "/pending", "/join/abc", "/account"])(
    "sends a German navigation to %s to the region page",
    (path) => {
      const response = regionBlockResponse(request(path, "DE"), HOSTED);

      expect(response?.status).toBe(307);
      expect(response?.headers.get("location")).toBe(`https://app.tendnote.com${REGION_PAGE_PATH}`);
    },
  );

  it.each(["GB", "CH", "NO", "fr", "RE"])("refuses %s", (country) => {
    expect(regionBlockResponse(request("/sign-up", country), HOSTED)).not.toBeNull();
  });

  it("refuses a sign-up or sign-in call outright rather than redirecting it", async () => {
    const response = regionBlockResponse(request("/api/auth/sign-up/email", "IE", "POST"), HOSTED);

    expect(response?.status).toBe(451);
    expect(await response?.text()).toMatch(/not available in your region/);
  });

  it("is the hosted default when no admission mode is configured", () => {
    expect(regionBlockResponse(request("/sign-in", "NL"), {})?.status).toBe(307);
  });

  it.each(["US", "CA", "JP"])("lets a request from %s through", (country) => {
    expect(regionBlockResponse(request("/sign-up", country), HOSTED)).toBeNull();
  });

  it("lets a request without a country header through", () => {
    expect(regionBlockResponse(request("/sign-up"), HOSTED)).toBeNull();
    expect(regionBlockResponse(request("/sign-up", ""), HOSTED)).toBeNull();
  });

  it.each([
    REGION_PAGE_PATH,
    "/api/cron/background-jobs",
    "/api/queue/reminder",
    "/api/internal/cache/reconcile",
    "/api/stripe/webhook",
    "/eve/v1/discord",
  ])("never refuses the exempt route %s", (path) => {
    expect(regionBlockResponse(request(path, "DE", "POST"), HOSTED)).toBeNull();
  });

  it("does not exempt a route that merely shares an exempt prefix", () => {
    expect(regionBlockResponse(request("/regional", "DE"), HOSTED)).not.toBeNull();
  });

  it("never runs on a self-hosted deployment", () => {
    expect(regionBlockResponse(request("/sign-up", "DE"), SELF_HOSTED)).toBeNull();
    expect(
      regionBlockResponse(request("/api/auth/sign-in/email", "DE", "POST"), SELF_HOSTED),
    ).toBeNull();
  });
});
