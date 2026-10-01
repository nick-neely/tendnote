import type { DeletionRecord } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createBlobRecoveryJournal, resolveRecoveryJournal } from "./recovery-journal";

const RECORD: DeletionRecord = {
  kind: "deletion",
  subjectKind: "account",
  subjectId: "user_1",
  at: new Date("2026-09-21T14:03:22.145Z"),
};
const PATHNAME = "journal/deletion/2026-09-21T14:03:22.145Z-account-user_1.json";

function blobClient(
  overrides: { put?: () => Promise<unknown>; head?: () => Promise<unknown> } = {},
) {
  return {
    put: vi.fn(overrides.put ?? (async () => ({}))),
    head: vi.fn(overrides.head ?? (async () => ({}))),
  };
}

describe("createBlobRecoveryJournal", () => {
  it("writes one private, never-overwritten blob at the record's pathname", async () => {
    const client = blobClient();

    await createBlobRecoveryJournal({ token: "t", client }).write(RECORD);

    expect(client.put).toHaveBeenCalledWith(
      PATHNAME,
      JSON.stringify({
        kind: "deletion",
        subjectKind: "account",
        subjectId: "user_1",
        at: "2026-09-21T14:03:22.145Z",
      }),
      {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
        token: "t",
      },
    );
  });

  it("treats a refused write whose blob already exists as written", async () => {
    const client = blobClient({
      put: async () => {
        throw new Error("Unknown error, please visit https://vercel.com/help.");
      },
    });

    await expect(createBlobRecoveryJournal({ token: "t", client }).write(RECORD)).resolves.toBe(
      undefined,
    );
    expect(client.head).toHaveBeenCalledWith(PATHNAME, { token: "t" });
  });

  it("surfaces the write failure when the blob is not there", async () => {
    const client = blobClient({
      put: async () => {
        throw new Error("store unavailable");
      },
      head: async () => {
        throw new Error("not found");
      },
    });

    await expect(createBlobRecoveryJournal({ token: "t", client }).write(RECORD)).rejects.toThrow(
      "store unavailable",
    );
  });
});

describe("resolveRecoveryJournal", () => {
  it("refuses every write on a hosted production deployment without a store", async () => {
    const journal = resolveRecoveryJournal({ NODE_ENV: "production" });

    await expect(journal.write(RECORD)).rejects.toThrow(/RECOVERY_JOURNAL_READ_WRITE_TOKEN/);
  });

  it("skips journaling where no hosted backup promise applies", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const env of [
      { NODE_ENV: "development" },
      {
        NODE_ENV: "production",
        TENDNOTE_ADMISSION_MODE: "self-hosted",
        TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
      },
    ]) {
      await expect(resolveRecoveryJournal(env).write(RECORD)).resolves.toBe(undefined);
    }
    warn.mockRestore();
  });
});
