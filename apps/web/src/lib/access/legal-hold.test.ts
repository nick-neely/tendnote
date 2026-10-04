import type { RecoveryJournalRecord } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { placeLegalHold } from "./legal-hold";
import { createLegalHoldsFake } from "./legal-holds-fake";

const NOW = new Date("2026-10-04T15:30:00.000Z");
const LATER = new Date("2026-10-05T09:00:00.000Z");

function legalHold() {
  const { legalHolds, holds } = createLegalHoldsFake();
  const journaled: RecoveryJournalRecord[] = [];
  const deps = {
    legalHolds,
    journal: { write: async (r: RecoveryJournalRecord) => void journaled.push(r) },
  };
  return { deps, holds, journaled };
}

describe("placing a Legal Hold (#632)", () => {
  it("records the hold until the start of its expiry date in UTC, then journals it", async () => {
    const op = legalHold();

    await expect(
      placeLegalHold(op.deps, { userId: "u1", expiresOn: "2027-01-31", now: NOW }),
    ).resolves.toEqual({
      holdId: "hold_1",
      userId: "u1",
      heldUntil: new Date("2027-01-31T00:00:00.000Z"),
    });
    expect(op.journaled).toEqual([
      { kind: "legal-hold", accountId: "u1", actionId: "hold_1", at: NOW },
    ]);
  });

  it("journals the same record again when the same hold is placed again", async () => {
    const op = legalHold();

    await placeLegalHold(op.deps, { userId: "u1", expiresOn: "2027-01-31", now: NOW });
    await placeLegalHold(op.deps, { userId: "u1", expiresOn: "2027-01-31", now: LATER });

    expect(op.holds).toHaveLength(1);
    expect(op.journaled).toEqual([
      { kind: "legal-hold", accountId: "u1", actionId: "hold_1", at: NOW },
      { kind: "legal-hold", accountId: "u1", actionId: "hold_1", at: NOW },
    ]);
  });

  it("says how to finish a hold whose journal write failed, and finishes it on the rerun", async () => {
    const op = legalHold();
    const write = op.deps.journal.write;
    op.deps.journal.write = async () => {
      throw new Error("blob store unavailable");
    };

    await expect(
      placeLegalHold(op.deps, { userId: "u1", expiresOn: "2027-01-31", now: NOW }),
    ).rejects.toThrow(
      "Legal Hold hold_1 is in force but not yet journaled, so a restore would lose it. Run the same command again until it succeeds.",
    );

    op.deps.journal.write = write;
    await placeLegalHold(op.deps, { userId: "u1", expiresOn: "2027-01-31", now: LATER });
    expect(op.holds).toHaveLength(1);
    expect(op.journaled).toEqual([
      { kind: "legal-hold", accountId: "u1", actionId: "hold_1", at: NOW },
    ]);
  });

  it("extends a hold with a second record rather than changing the first", async () => {
    const op = legalHold();

    await placeLegalHold(op.deps, { userId: "u1", expiresOn: "2027-01-31", now: NOW });
    await placeLegalHold(op.deps, { userId: "u1", expiresOn: "2027-06-30", now: LATER });

    expect(op.holds.map((hold) => hold.expiresAt.toISOString())).toEqual([
      "2027-01-31T00:00:00.000Z",
      "2027-06-30T00:00:00.000Z",
    ]);
  });

  it.each([["2027-1-31"], ["2027-02-30"], ["31/01/2027"], ["2027-01-31T00:00:00Z"]])(
    "refuses %s as an expiry, writing nothing",
    async (expiresOn) => {
      const op = legalHold();

      await expect(placeLegalHold(op.deps, { userId: "u1", expiresOn, now: NOW })).rejects.toThrow(
        "A Legal Hold expires on a date, such as 2027-01-31.",
      );
      expect(op.holds).toEqual([]);
      expect(op.journaled).toEqual([]);
    },
  );

  it("refuses an expiry that has already begun, writing nothing", async () => {
    const op = legalHold();

    // Today began at midnight UTC, so a hold expiring today is already over.
    await expect(
      placeLegalHold(op.deps, { userId: "u1", expiresOn: "2026-10-04", now: NOW }),
    ).rejects.toThrow("A Legal Hold expiring 2026-10-04 is already over.");
    expect(op.holds).toEqual([]);
    expect(op.journaled).toEqual([]);
  });
});
