import { describe, expect, it } from "vitest";
import { decideAdmission, parseAdmissionPolicy } from "./admission";

describe("self-hosted admission policy", () => {
  it("defaults to hosted when admission mode is absent", () => {
    expect(parseAdmissionPolicy({})).toEqual({ mode: "hosted", valid: true });
  });

  it("accepts hosted mode without a self-hosted owner", () => {
    expect(parseAdmissionPolicy({ TENDNOTE_ADMISSION_MODE: " hosted " })).toEqual({
      mode: "hosted",
      valid: true,
    });
  });

  it("normalizes the one configured self-hosted owner email", () => {
    expect(
      parseAdmissionPolicy({
        TENDNOTE_ADMISSION_MODE: "self-hosted",
        TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "  Owner@Example.COM ",
      }),
    ).toEqual({ mode: "self-hosted", valid: true, bootstrapOwnerEmail: "owner@example.com" });
  });

  it.each([
    ["unsupported mode", { TENDNOTE_ADMISSION_MODE: "automatic" }, "invalid_mode"],
    ["empty mode", { TENDNOTE_ADMISSION_MODE: "   " }, "invalid_mode"],
    [
      "missing self-hosted owner",
      { TENDNOTE_ADMISSION_MODE: "self-hosted" },
      "missing_bootstrap_owner_email",
    ],
    [
      "malformed self-hosted owner",
      {
        TENDNOTE_ADMISSION_MODE: "self-hosted",
        TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "not-an-email",
      },
      "invalid_bootstrap_owner_email",
    ],
    [
      "multiple self-hosted owners",
      {
        TENDNOTE_ADMISSION_MODE: "self-hosted",
        TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "one@example.com,two@example.com",
      },
      "invalid_bootstrap_owner_email",
    ],
  ])("fails closed for %s", (_name, env, code) => {
    expect(parseAdmissionPolicy(env)).toEqual({
      mode: "invalid",
      valid: false,
      diagnostic: { code },
    });
  });

  it("never includes configured values in an invalid diagnostic", () => {
    expect(
      parseAdmissionPolicy({
        TENDNOTE_ADMISSION_MODE: "self-hosted",
        TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "owner@example.com\nsecret-value",
      }),
    ).toEqual({
      mode: "invalid",
      valid: false,
      diagnostic: { code: "invalid_bootstrap_owner_email" },
    });
  });
});

describe("admission decision (ADR 0248)", () => {
  const dunning = { kind: "dunning_expiry", event: "in_failed" };

  it("admits when a source admits and no block is active", () => {
    expect(decideAdmission({ sourceAdmits: true, blocks: [] })).toBe(true);
  });

  it("never admits without a source, even with no blocks", () => {
    expect(decideAdmission({ sourceAdmits: false, blocks: [] })).toBe(false);
  });

  it("refuses an admitted source while an unexcepted block is active", () => {
    expect(decideAdmission({ sourceAdmits: true, blocks: [{ ...dunning, exceptions: [] }] })).toBe(
      false,
    );
  });

  it("lifts a block only with an exception naming the event it excepts", () => {
    expect(
      decideAdmission({
        sourceAdmits: true,
        blocks: [{ ...dunning, exceptions: [{ event: "in_failed" }] }],
      }),
    ).toBe(true);
    expect(
      decideAdmission({
        sourceAdmits: true,
        blocks: [{ ...dunning, exceptions: [{ event: "in_other" }] }],
      }),
    ).toBe(false);
  });

  it("requires every active block to be excepted", () => {
    expect(
      decideAdmission({
        sourceAdmits: true,
        blocks: [
          { ...dunning, exceptions: [{ event: "in_failed" }] },
          { kind: "suspension", event: "suspension-1", exceptions: [] },
        ],
      }),
    ).toBe(false);
  });

  it("never lets an exception stand in for a source", () => {
    expect(
      decideAdmission({
        sourceAdmits: false,
        blocks: [{ ...dunning, exceptions: [{ event: "in_failed" }] }],
      }),
    ).toBe(false);
  });
});
