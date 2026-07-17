import { describe, expect, it } from "vitest";
import { resolveAgentRedisUrl } from "../agent/lib/redis";

describe("hosted Eve Redis configuration", () => {
  it("requires an explicit production service URL", () => {
    expect(() => resolveAgentRedisUrl({ NODE_ENV: "production" })).toThrow(
      "REDIS_URL is required by the hosted Eve service in production",
    );
  });

  it("preserves the project-specific local default outside production", () => {
    expect(resolveAgentRedisUrl({ NODE_ENV: "development" })).toBe("redis://localhost:56379");
  });

  it("uses the configured service URL", () => {
    expect(
      resolveAgentRedisUrl({ NODE_ENV: "production", REDIS_URL: "redis://managed:6379" }),
    ).toBe("redis://managed:6379");
  });
});
