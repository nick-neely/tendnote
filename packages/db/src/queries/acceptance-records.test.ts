import type { LegalDocument } from "@tendnote/domain/legal-documents";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rows: [] as { documentKey: string; version: string }[],
  reads: 0,
}));

vi.mock("../client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => {
          db.reads += 1;
          return db.rows;
        },
      }),
    }),
  }),
}));

import { listOutstandingReacceptance } from "./acceptance-records";

const flaggedTerms: LegalDocument = {
  key: "terms_of_service",
  title: "Terms of Service",
  version: "0.2",
  effectiveDate: "2026-11-01",
  path: "docs/legal/terms-of-service.md",
  reacceptance: { changes: ["Fair-use limits are now stated in Eve turns."] },
};
const unflaggedPrivacy: LegalDocument = {
  key: "privacy_policy",
  title: "Privacy Policy",
  version: "0.1",
  effectiveDate: "2026-09-27",
  path: "docs/legal/privacy-policy.md",
};
const hosted = { TENDNOTE_ADMISSION_MODE: "hosted" };

describe("listOutstandingReacceptance", () => {
  beforeEach(() => {
    db.rows = [];
    db.reads = 0;
  });

  it("owes a hosted account the flagged version it has not accepted", async () => {
    db.rows = [{ documentKey: "terms_of_service", version: "0.1" }];

    await expect(
      listOutstandingReacceptance({
        userId: "user-1",
        documents: [flaggedTerms, unflaggedPrivacy],
        env: hosted,
      }),
    ).resolves.toEqual([flaggedTerms]);
  });

  it("clears once the flagged version is on record", async () => {
    db.rows = [{ documentKey: "terms_of_service", version: "0.2" }];

    await expect(
      listOutstandingReacceptance({ userId: "user-1", documents: [flaggedTerms], env: hosted }),
    ).resolves.toEqual([]);
  });

  it("reads nothing when no current version is flagged", async () => {
    await expect(
      listOutstandingReacceptance({ userId: "user-1", documents: [unflaggedPrivacy], env: hosted }),
    ).resolves.toEqual([]);
    expect(db.reads).toBe(0);
  });

  it("never gates a self-hosted deployment, whose operator's terms are not Tendnote's", async () => {
    await expect(
      listOutstandingReacceptance({
        userId: "user-1",
        documents: [flaggedTerms],
        env: {
          TENDNOTE_ADMISSION_MODE: "self-hosted",
          TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
        },
      }),
    ).resolves.toEqual([]);
    expect(db.reads).toBe(0);
  });
});
