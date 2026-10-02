import type { DeletionRecord } from "@tendnote/domain";
import { beforeEach, expect, it, vi } from "vitest";

const { head, put } = vi.hoisted(() => ({ head: vi.fn(), put: vi.fn() }));
vi.mock("@vercel/blob", () => ({ head, put }));

import { blobRecoveryJournal } from "./blob-journal";

const RECORD: DeletionRecord = {
  kind: "deletion",
  subjectKind: "account",
  subjectId: "user_1",
  at: new Date("2026-09-21T14:03:22.145Z"),
};
const PATHNAME = "journal/deletion/2026-09-21T14:03:22.145Z-account-user_1.json";

beforeEach(() => vi.resetAllMocks());

it("writes one private, never-overwritten blob at the record's pathname", async () => {
  await blobRecoveryJournal.write(RECORD);

  expect(put).toHaveBeenCalledWith(
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
    },
  );
});

it("treats a refused write whose blob already exists as written", async () => {
  put.mockRejectedValue(new Error("Unknown error, please visit https://vercel.com/help."));
  head.mockResolvedValue({ pathname: PATHNAME });

  await expect(blobRecoveryJournal.write(RECORD)).resolves.toBeUndefined();
  expect(head).toHaveBeenCalledWith(PATHNAME);
});

it("surfaces the write failure when the blob is not there", async () => {
  put.mockRejectedValue(new Error("store unavailable"));
  head.mockRejectedValue(new Error("not found"));

  await expect(blobRecoveryJournal.write(RECORD)).rejects.toThrow("store unavailable");
});
