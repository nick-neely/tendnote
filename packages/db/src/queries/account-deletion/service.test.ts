import { recoveryJournalEntry } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryRecoveryJournal } from "./in-memory-journal";
import { createInMemoryAccountDeletionStore } from "./in-memory-store";
import {
  accountDeletionAdmissionBlocks,
  requestAccountDeletion,
  runAccountDeletionSweep,
} from "./service";

const NOW = new Date("2026-09-21T14:03:22.145Z");
const HOUR_MS = 60 * 60 * 1000;

function harness() {
  const steps: string[] = [];
  const store = createInMemoryAccountDeletionStore({ steps });
  const journal = createInMemoryRecoveryJournal({ steps });
  const revokeSessions = vi.fn(async ({ userId }: { userId: string }) => {
    steps.push(`revoke:${userId}`);
  });
  const cancelSubscriptions = vi.fn(async ({ userId }: { userId: string }) => {
    steps.push(`cancel:${userId}`);
  });
  const confirmPurge = vi.fn(async ({ to }: { to: string }) => {
    steps.push(`confirm:${to}`);
  });
  const logger = { info: vi.fn(), error: vi.fn() };
  store.seedAccount("user_1");
  return {
    steps,
    store,
    journal,
    revokeSessions,
    confirmPurge,
    logger,
    deps: { store, journal, revokeSessions, cancelSubscriptions, confirmPurge, logger },
  };
}

describe("requestAccountDeletion", () => {
  it("commits the intent, revokes sessions, cancels billing, journals the Deletion Record, then deletes", async () => {
    const { steps, store, journal, deps } = harness();

    const result = await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    expect(result).toEqual({ status: "deleted" });
    expect(steps).toEqual([
      "intent:user_1",
      "revoke:user_1",
      "cancel:user_1",
      "journal:user_1",
      "journaled:user_1",
      "delete:user_1",
    ]);
    expect(store.hasAccount("user_1")).toBe(false);
    expect(await store.findIntent({ userId: "user_1" })).toBeNull();
    expect(journal.pathnames()).toEqual([
      recoveryJournalEntry({
        kind: "deletion",
        subjectKind: "account",
        subjectId: "user_1",
        at: NOW,
      }).pathname,
    ]);
  });

  it("still journals and deletes when session revocation fails at request time", async () => {
    const { store, deps, logger } = harness();
    deps.revokeSessions.mockRejectedValueOnce(new Error("redis down"));

    const result = await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    expect(result).toEqual({ status: "deleted" });
    expect(store.hasAccount("user_1")).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      "account_deletion.session_revocation_failed",
      expect.objectContaining({ userId: "user_1" }),
    );
  });

  it("closes the account at intent commit even when the journal write fails", async () => {
    const { steps, store, journal, deps, logger } = harness();
    journal.failNextWrites(1);

    const result = await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    expect(result).toEqual({ status: "pending" });
    expect(steps).toEqual(["intent:user_1", "revoke:user_1", "cancel:user_1"]);
    expect(store.hasAccount("user_1")).toBe(true);
    const intent = await store.findIntent({ userId: "user_1" });
    expect(intent).toMatchObject({ userId: "user_1", journaledAt: null });
    expect(accountDeletionAdmissionBlocks(intent)).toEqual([
      { kind: "account_deletion", event: `account_deletion:${NOW.toISOString()}`, exceptions: [] },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      "account_deletion.deferred",
      expect.not.objectContaining({ email: expect.anything() }),
    );
  });

  it("never deletes rows when the journal is unreachable", async () => {
    const { store, journal, deps } = harness();
    journal.failNextWrites(Number.POSITIVE_INFINITY);

    await requestAccountDeletion(deps, { userId: "user_1", now: NOW });
    await runAccountDeletionSweep({ ...deps, limit: 10, now: new Date(NOW.getTime() + HOUR_MS) });

    expect(store.hasAccount("user_1")).toBe(true);
    expect(journal.pathnames()).toEqual([]);
  });

  it("keeps the first request's moment when the customer asks again", async () => {
    const { store, journal, deps } = harness();
    journal.failNextWrites(1);
    await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    await requestAccountDeletion(deps, {
      userId: "user_1",
      now: new Date(NOW.getTime() + HOUR_MS),
    });

    expect(store.hasAccount("user_1")).toBe(false);
    expect(journal.records()).toEqual([
      { kind: "deletion", subjectKind: "account", subjectId: "user_1", at: NOW.toISOString() },
    ]);
  });

  it("journals and deletes nothing until the subscription is cancelled", async () => {
    const { steps, store, journal, deps } = harness();
    deps.cancelSubscriptions.mockRejectedValueOnce(new Error("stripe down"));

    const result = await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    expect(result).toEqual({ status: "pending" });
    expect(steps).toEqual(["intent:user_1", "revoke:user_1"]);
    expect(journal.pathnames()).toEqual([]);
    expect(store.hasAccount("user_1")).toBe(true);

    await runAccountDeletionSweep({ ...deps, limit: 10, now: NOW });

    expect(deps.cancelSubscriptions).toHaveBeenCalledTimes(2);
    expect(store.hasAccount("user_1")).toBe(false);
  });

  it("does not re-journal an intent that was journaled before the delete failed", async () => {
    const { steps, store, deps } = harness();
    store.failNextDeletes(1);
    await requestAccountDeletion(deps, { userId: "user_1", now: NOW });
    steps.length = 0;

    await runAccountDeletionSweep({ ...deps, limit: 10, now: NOW });

    expect(steps).toEqual(["revoke:user_1", "cancel:user_1", "delete:user_1"]);
    expect(store.hasAccount("user_1")).toBe(false);
  });

  it("does not confirm the owner's own deletion by email", async () => {
    const { deps, confirmPurge } = harness();

    await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    expect(confirmPurge).not.toHaveBeenCalled();
  });
});

describe("retention-deadline purge confirmation", () => {
  it("confirms to the account's address only once its rows are gone", async () => {
    const { steps, store, deps, confirmPurge } = harness();
    store.seedIntent({ userId: "user_1", at: NOW, reason: "retention_deadline" });

    const result = await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    expect(result).toEqual({ status: "deleted" });
    expect(steps.slice(-2)).toEqual(["delete:user_1", "confirm:user_1@example.test"]);
    expect(confirmPurge).toHaveBeenCalledWith({
      to: "user_1@example.test",
      userId: "user_1",
      requestedAt: NOW,
    });
  });

  it("confirms a purge the recovery sweep finished", async () => {
    const { store, journal, deps, confirmPurge } = harness();
    store.seedIntent({ userId: "user_1", at: NOW, reason: "retention_deadline" });
    journal.failNextWrites(1);
    await requestAccountDeletion(deps, { userId: "user_1", now: NOW });
    expect(confirmPurge).not.toHaveBeenCalled();

    await runAccountDeletionSweep({ ...deps, limit: 10, now: NOW });

    expect(confirmPurge).toHaveBeenCalledOnce();
  });

  it("logs a failed confirmation without undoing or failing the purge", async () => {
    const { store, deps, confirmPurge, logger } = harness();
    store.seedIntent({ userId: "user_1", at: NOW, reason: "retention_deadline" });
    confirmPurge.mockRejectedValueOnce(new Error("resend down"));

    const result = await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    expect(result).toEqual({ status: "deleted" });
    expect(store.hasAccount("user_1")).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      "account_deletion.purge_confirmation_failed",
      expect.objectContaining({ userId: "user_1" }),
    );
  });
});

describe("under a Legal Hold (#632)", () => {
  const HOLD_ENDS = new Date(NOW.getTime() + 48 * HOUR_MS);

  it("closes the account and stops billing, but journals and deletes nothing", async () => {
    const { steps, store, journal, deps, logger } = harness();
    store.placeLegalHold("user_1", HOLD_ENDS);

    const result = await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    expect(result).toEqual({ status: "pending" });
    expect(steps).toEqual(["intent:user_1", "revoke:user_1", "cancel:user_1"]);
    expect(store.hasAccount("user_1")).toBe(true);
    expect(await store.findIntent({ userId: "user_1" })).toMatchObject({ journaledAt: null });
    expect(journal.pathnames()).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith("account_deletion.held", { userId: "user_1" });
  });

  it("leaves a held intent to wait out of the sweep, then finishes it once the hold ends", async () => {
    const { store, deps } = harness();
    store.placeLegalHold("user_1", HOLD_ENDS);
    await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    const during = await runAccountDeletionSweep({
      ...deps,
      limit: 10,
      now: new Date(HOLD_ENDS.getTime() - 1),
    });
    expect(during).toEqual({ scanned: 0, completed: 0, failed: 0, stuck: 0 });
    expect(store.hasAccount("user_1")).toBe(true);

    const after = await runAccountDeletionSweep({ ...deps, limit: 10, now: HOLD_ENDS });
    expect(after).toEqual({ scanned: 1, completed: 1, failed: 0, stuck: 0 });
    expect(store.hasAccount("user_1")).toBe(false);
  });

  it("deletes another account with no hold as usual", async () => {
    const { store, deps } = harness();
    store.seedAccount("user_2");
    store.placeLegalHold("user_1", HOLD_ENDS);

    await expect(requestAccountDeletion(deps, { userId: "user_2", now: NOW })).resolves.toEqual({
      status: "deleted",
    });
    expect(store.hasAccount("user_2")).toBe(false);
  });

  it("stops short of the purge when the hold was placed after the sweep listed the intent", async () => {
    const { store, journal, deps, logger } = harness();
    journal.failNextWrites(1);
    await requestAccountDeletion(deps, { userId: "user_1", now: NOW });
    const listIntents = store.listIntents;
    store.listIntents = async (input) => {
      const listed = await listIntents(input);
      store.placeLegalHold("user_1", HOLD_ENDS);
      return listed;
    };

    const result = await runAccountDeletionSweep({ ...deps, limit: 10, now: NOW });

    expect(result).toEqual({ scanned: 1, completed: 0, failed: 0, stuck: 0 });
    expect(store.hasAccount("user_1")).toBe(true);
    expect(journal.pathnames()).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith("account_deletion.held", { userId: "user_1" });
  });
});

describe("runAccountDeletionSweep", () => {
  it("completes an intent whose journal write failed", async () => {
    const { store, journal, deps } = harness();
    journal.failNextWrites(1);
    await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    const result = await runAccountDeletionSweep({ ...deps, limit: 10, now: NOW });

    expect(result).toEqual({ scanned: 1, completed: 1, failed: 0, stuck: 0 });
    expect(store.hasAccount("user_1")).toBe(false);
    expect(journal.pathnames()).toHaveLength(1);
  });

  it("treats a Deletion Record already in the journal as written", async () => {
    const { store, journal, deps } = harness();
    await journal.write({ kind: "deletion", subjectKind: "account", subjectId: "user_1", at: NOW });
    store.failNextMarks(1);
    await requestAccountDeletion(deps, { userId: "user_1", now: NOW });

    await runAccountDeletionSweep({ ...deps, limit: 10, now: NOW });

    expect(store.hasAccount("user_1")).toBe(false);
    expect(journal.pathnames()).toHaveLength(1);
  });

  it("flags an intent still incomplete after twenty-four hours, and only that one", async () => {
    const { store, journal, deps, logger } = harness();
    store.seedAccount("user_2");
    journal.failNextWrites(Number.POSITIVE_INFINITY);
    await requestAccountDeletion(deps, { userId: "user_1", now: NOW });
    await requestAccountDeletion(deps, {
      userId: "user_2",
      now: new Date(NOW.getTime() + 2 * HOUR_MS),
    });

    const result = await runAccountDeletionSweep({
      ...deps,
      limit: 10,
      now: new Date(NOW.getTime() + 25 * HOUR_MS),
    });

    expect(result).toEqual({ scanned: 2, completed: 0, failed: 2, stuck: 1 });
    expect(logger.error).toHaveBeenCalledWith("account_deletion.intent_stuck", {
      userId: "user_1",
      requestedAt: NOW.toISOString(),
    });
    expect(logger.error).not.toHaveBeenCalledWith(
      "account_deletion.intent_stuck",
      expect.objectContaining({ requestedAt: new Date(NOW.getTime() + 2 * HOUR_MS).toISOString() }),
    );
  });

  it("drains the oldest intents first within its limit", async () => {
    const { store, journal, deps } = harness();
    store.seedAccount("user_2");
    journal.failNextWrites(2);
    await requestAccountDeletion(deps, { userId: "user_2", now: NOW });
    await requestAccountDeletion(deps, { userId: "user_1", now: new Date(NOW.getTime() + 1) });

    await runAccountDeletionSweep({ ...deps, limit: 1, now: NOW });

    expect(store.hasAccount("user_2")).toBe(false);
    expect(store.hasAccount("user_1")).toBe(true);
  });

  it("moves an intent that keeps failing behind ones not yet retried", async () => {
    const { store, journal, deps } = harness();
    store.seedAccount("user_2");
    journal.failNextWrites(3);
    await requestAccountDeletion(deps, { userId: "user_1", now: NOW });
    await requestAccountDeletion(deps, { userId: "user_2", now: new Date(NOW.getTime() + 1) });

    // user_1 is oldest, is retried first, and fails again.
    await runAccountDeletionSweep({ ...deps, limit: 1, now: new Date(NOW.getTime() + 2) });
    await runAccountDeletionSweep({ ...deps, limit: 1, now: new Date(NOW.getTime() + 3) });

    expect(store.hasAccount("user_1")).toBe(true);
    expect(store.hasAccount("user_2")).toBe(false);
  });
});

describe("accountDeletionAdmissionBlocks", () => {
  it("reads no block for an account with no intent", () => {
    expect(accountDeletionAdmissionBlocks(null)).toEqual([]);
  });
});
