import { describe, expect, it } from "vitest";
import {
  effectFenceDigest,
  effectFenceEntry,
  FENCED_EFFECTS,
  isDeletionIntentStuck,
  isEffectFenceExpired,
  type RecoveryJournalRecord,
  recoveryJournalEntry,
} from "./recovery-journal";
import { RETENTION } from "./retention";

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

describe("effect fences", () => {
  it("fences email sends and export deliveries, and never reminders", () => {
    expect(FENCED_EFFECTS).toEqual(["email", "export"]);
  });

  it("files a fence by its key's digest, so it holds nothing the key held", () => {
    const key = "admitted:in_123";
    const entry = effectFenceEntry({ effect: "email", key, at: AT });
    const digest = effectFenceDigest(key);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.pathname).toBe(`fence/email/2026-09-21T14:03:22.145Z-${digest}.json`);
    expect(JSON.parse(entry.body)).toEqual({
      effect: "email",
      digest,
      at: "2026-09-21T14:03:22.145Z",
    });
    expect(`${entry.pathname}${entry.body}`).not.toContain("in_123");
  });

  it("expires a fence exactly at its retention constant", () => {
    const { pathname } = effectFenceEntry({ effect: "export", key: "owner:request", at: AT });
    const retention = RETENTION.effectFence.days * 24 * HOUR_MS;

    expect(isEffectFenceExpired({ pathname, now: new Date(AT.getTime() + retention - 1) })).toBe(
      false,
    );
    expect(isEffectFenceExpired({ pathname, now: new Date(AT.getTime() + retention) })).toBe(true);
  });

  it("never expires a pathname it did not write", () => {
    const now = new Date("2030-01-01T00:00:00.000Z");

    expect(
      isEffectFenceExpired({ pathname: "journal/deletion/2026-01-01T00:00:00.000Z-x.json", now }),
    ).toBe(false);
    expect(isEffectFenceExpired({ pathname: "fence/email/not-a-time-x.json", now })).toBe(false);
  });
});
