import { describe, expect, it, vi } from "vitest";
import { captureRequestFunnelStage } from "./account-funnel";

const hosted = { TENDNOTE_ADMISSION_MODE: "hosted" };

function from(country?: string) {
  return new Headers(country === undefined ? {} : { "x-vercel-ip-country": country });
}

async function capture(headers: Headers | undefined, env: Record<string, string> = hosted) {
  const record = vi.fn(async () => {});
  const suppress = vi.fn(async () => {});
  await captureRequestFunnelStage(
    { userId: "account-1", stage: "signup_completed", headers },
    { env, record, suppress },
  );
  return Object.assign(record, { suppress });
}

describe("capturing a request's funnel stage", () => {
  it("records a hosted request known to come from the US", async () => {
    const record = await capture(from("US"));

    expect(record.suppress).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledExactlyOnceWith({
      userId: "account-1",
      stage: "signup_completed",
    });
  });

  it("accepts the country code in any case", async () => {
    expect(await capture(from(" us "))).toHaveBeenCalledOnce();
  });

  it.each([
    ["another country", from("CA")],
    ["a Region Block country", from("DE")],
    ["an unknown country", from()],
    ["an empty country", from("")],
    ["no request at all", undefined],
  ])("suppresses %s, suspending what follows from it", async (_name, headers) => {
    const record = await capture(headers);

    expect(record).not.toHaveBeenCalled();
    expect(record.suppress).toHaveBeenCalledExactlyOnceWith({
      userId: "account-1",
      stage: "signup_completed",
    });
  });

  it("collects nothing on a self-hosted deployment, even from the US", async () => {
    const selfHosted = {
      TENDNOTE_ADMISSION_MODE: "self-hosted",
      TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
    };
    const record = await capture(from("US"), selfHosted);

    expect(record).not.toHaveBeenCalled();
    expect(record.suppress).not.toHaveBeenCalled();
  });
});
