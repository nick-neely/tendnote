import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("redirects", () => {
  it("send only the old invitation, sign-in, and sign-up links permanently to the app", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects?.map(({ source, permanent }) => [source, permanent])).toEqual([
      ["/join/:path+", true],
      ["/sign-in", true],
      ["/sign-up", true],
    ]);
  });
});
