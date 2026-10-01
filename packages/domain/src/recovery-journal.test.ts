import { describe, expect, it } from "vitest";
import {
  isDeletionIntentStuck,
  type RecoveryJournalRecord,
  recoveryJournalEntry,
} from "./recovery-journal";

const AT = new Date("2026-09-21T14:03:22.145Z");
const HOUR_MS = 60 * 60 * 1000;

describe("recoveryJournalEntry", () => {
  it("files a Deletion Record under its kind with a timestamp-first pathname", () => {
    const entry = recoveryJournalEntry({
      kind: "deletion",
      subjectKind: "account",
      subjectId: "user_123",
      at: AT,
    });

    expect(entry.pathname).toBe("journal/deletion/2026-09-21T14:03:22.145Z-account-user_123.json");
    expect(JSON.parse(entry.body)).toEqual({
      kind: "deletion",
      subjectKind: "account",
      subjectId: "user_123",
      at: "2026-09-21T14:03:22.145Z",
    });
  });

  it("files an operator record under its action with the action id", () => {
    const entry = recoveryJournalEntry({
      kind: "suspension",
      accountId: "user_123",
      actionId: "action-9",
      at: AT,
    });

    expect(entry.pathname).toBe(
      "journal/suspension/2026-09-21T14:03:22.145Z-user_123-action-9.json",
    );
    expect(JSON.parse(entry.body)).toEqual({
      kind: "suspension",
      accountId: "user_123",
      actionId: "action-9",
      at: "2026-09-21T14:03:22.145Z",
    });
  });

  it("sorts pathnames lexicographically in time order, including across a digit rollover", () => {
    const record = (at: Date): RecoveryJournalRecord => ({
      kind: "deletion",
      subjectKind: "account",
      subjectId: "u",
      at,
    });
    const moments = [
      new Date("2026-09-09T23:59:59.999Z"),
      new Date("2026-09-10T00:00:00.000Z"),
      new Date("2026-09-10T00:00:00.001Z"),
      new Date("2026-10-01T09:00:00.000Z"),
    ];
    const pathnames = moments.map((at) => recoveryJournalEntry(record(at)).pathname);

    expect([...pathnames].sort()).toEqual(pathnames);
    expect(new Set(pathnames.map((pathname) => pathname.length)).size).toBe(1);
  });

  it("refuses an identifier that could escape its pathname segment", () => {
    for (const subjectId of ["", "a/b", "../x", "a b", "a.json"]) {
      expect(() =>
        recoveryJournalEntry({ kind: "deletion", subjectKind: "account", subjectId, at: AT }),
      ).toThrow(/identifier/);
    }
  });
});

describe("isDeletionIntentStuck", () => {
  it("flags an intent still incomplete after twenty-four hours, and not before", () => {
    const requestedAt = new Date("2026-09-21T00:00:00.000Z");

    expect(
      isDeletionIntentStuck({
        requestedAt,
        now: new Date(requestedAt.getTime() + 24 * HOUR_MS - 1),
      }),
    ).toBe(false);
    expect(
      isDeletionIntentStuck({ requestedAt, now: new Date(requestedAt.getTime() + 24 * HOUR_MS) }),
    ).toBe(true);
  });
});
