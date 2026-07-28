import { describe, expect, it } from "vitest";
import { appDestination } from "@/components/app-destinations";
import { GET } from "./route";

describe("service-worker destination configuration", () => {
  it("serves the notification fallback from the destination module", async () => {
    const response = GET();

    await expect(response.json()).resolves.toEqual({
      notificationFallback: appDestination("actions").route,
    });
    expect(response.headers.get("cache-control")).toContain("must-revalidate");
  });
});
