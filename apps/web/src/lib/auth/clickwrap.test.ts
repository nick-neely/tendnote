import {
  CLICKWRAP_REQUIRED_MESSAGE,
  CURRENT_LEGAL_DOCUMENTS,
  clickwrapAcceptance,
} from "@tendnote/domain/legal-documents";
import { describe, expect, it, vi } from "vitest";
import { createClickwrapHooks } from "./clickwrap";

const HOSTED = { TENDNOTE_ADMISSION_MODE: "hosted" };
const SELF_HOSTED = {
  TENDNOTE_ADMISSION_MODE: "self-hosted",
  TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
};

function hooks(env: Record<string, string>, oauthState: unknown = null) {
  const record = vi.fn(async () => undefined);
  return {
    record,
    ...createClickwrapHooks({ env, record, readOAuthState: async () => oauthState }),
  };
}

const emailSignUp = (legalAcceptance?: unknown) => ({
  body: { email: "new@example.com", password: "secret-password", name: "New", legalAcceptance },
});

describe("hosted clickwrap at sign-up", () => {
  it("refuses an email sign-up without acceptance", async () => {
    const clickwrap = hooks(HOSTED);

    await expect(clickwrap.requireAcceptance(emailSignUp())).rejects.toMatchObject({
      body: { code: "ACCEPTANCE_REQUIRED", message: CLICKWRAP_REQUIRED_MESSAGE },
    });
  });

  it("refuses a sign-up that accepted the documents but not the eligibility statement", async () => {
    const clickwrap = hooks(HOSTED);

    await expect(
      clickwrap.requireAcceptance(emailSignUp({ ...clickwrapAcceptance(), eligible: false })),
    ).rejects.toMatchObject({ body: { code: "ACCEPTANCE_REQUIRED" } });
  });

  it("admits an email sign-up that accepted the current versions", async () => {
    const clickwrap = hooks(HOSTED);

    await expect(
      clickwrap.requireAcceptance(emailSignUp(clickwrapAcceptance())),
    ).resolves.toBeUndefined();
  });

  it("reads an OAuth sign-up's acceptance from the flow state", async () => {
    const accepted = hooks(HOSTED, { legalAcceptance: clickwrapAcceptance() });
    const skipped = hooks(HOSTED, { callbackURL: "/" });

    await expect(accepted.requireAcceptance({ body: undefined })).resolves.toBeUndefined();
    await expect(skipped.requireAcceptance({ body: undefined })).rejects.toMatchObject({
      body: { code: "ACCEPTANCE_REQUIRED" },
    });
  });

  it("records exactly the current document versions for the new account", async () => {
    const clickwrap = hooks(HOSTED);

    await clickwrap.recordAcceptance({ id: "user-1" }, emailSignUp(clickwrapAcceptance()));

    expect(clickwrap.record).toHaveBeenCalledWith({
      userId: "user-1",
      documents: CURRENT_LEGAL_DOCUMENTS,
    });
  });

  it("leaves server-side provisioning outside any endpoint alone", async () => {
    const clickwrap = hooks(HOSTED);

    await expect(clickwrap.requireAcceptance(null)).resolves.toBeUndefined();
    await clickwrap.recordAcceptance({ id: "local-owner" }, null);
    expect(clickwrap.record).not.toHaveBeenCalled();
  });

  it("never runs on a self-hosted deployment", async () => {
    const clickwrap = hooks(SELF_HOSTED);

    await expect(clickwrap.requireAcceptance(emailSignUp())).resolves.toBeUndefined();
    await clickwrap.recordAcceptance({ id: "user-1" }, emailSignUp());
    expect(clickwrap.record).not.toHaveBeenCalled();
  });
});
