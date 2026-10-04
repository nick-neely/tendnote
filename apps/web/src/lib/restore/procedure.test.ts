import {
  type DeletionRecord,
  effectFenceDigest,
  effectFenceEntry,
  type OperatorRecordKind,
  type RecoveryJournalRecord,
  recoveryJournalEntry,
} from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import type { StripeReconciliationResult } from "@/lib/billing/stripe-reconciliation";
import {
  applyDeletionRecords,
  invalidateSessions,
  markFencedEffects,
  pauseOutbound,
  type RestoreDependencies,
  reconcileAdmission,
  resumeOutbound,
  resumeWrites,
  runRestoreStep,
  stopWrites,
  verifyRestore,
  writeCutoverMarker,
} from "./procedure";

const T0 = new Date("2026-10-01T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60 * 1000);

const STRIPE_RAN: StripeReconciliationResult = {
  status: "ran",
  scanned: 0,
  admitted: 0,
  dunningClosed: 0,
  revoked: 0,
  unmatchedRefunds: 0,
  unknownCustomer: 0,
  failed: 0,
};

function deletion(subjectKind: "account" | "household", subjectId: string, minutes: number) {
  return { kind: "deletion", subjectKind, subjectId, at: at(minutes) } satisfies DeletionRecord;
}

/**
 * Production's journal and a restored branch, in memory. Accounts and
 * households are what the branch holds; the journal is shared, as it is in a
 * real restore.
 */
function createRestore(
  options: {
    accounts?: string[];
    households?: string[];
    recorded?: Partial<Record<OperatorRecordKind, string[]>>;
    exportJobs?: { id: string; key: string }[];
    sessions?: number;
    redisSessions?: number;
    stripe?: StripeReconciliationResult;
    intents?: DeletionRecord[];
  } = {},
) {
  const blobs = new Map<string, string>();
  const listings: string[][] = [];
  /** Entries that become listable only after the next listing. */
  const late: { pathname: string; body: string }[] = [];
  const accounts = new Set(options.accounts ?? []);
  const households = new Set(options.households ?? []);
  const emailFences = new Set<string>();
  const exportJobs = (options.exportJobs ?? []).map((job) => ({ ...job, done: false }));
  const applied: string[] = [];
  const intents = options.intents ?? [];
  let sessions = options.sessions ?? 0;
  let redisSessions = options.redisSessions ?? 0;
  let paused = false;
  let writesStopped = false;
  let clockMs = T0.getTime();

  const deps: RestoreDependencies = {
    journal: {
      async list(prefix) {
        const listed = [...blobs.keys()].filter((pathname) => pathname.startsWith(prefix)).sort();
        listings.push(listed);
        for (const entry of late.splice(0)) blobs.set(entry.pathname, entry.body);
        return listed;
      },
      async read(pathname) {
        const body = blobs.get(pathname);
        return body === undefined ? null : { pathname, body };
      },
      async write(entry) {
        if (!blobs.has(entry.pathname)) blobs.set(entry.pathname, entry.body);
      },
    },
    database: {
      async pauseOutbound() {
        paused = true;
      },
      async resumeOutbound() {
        paused = false;
      },
      isOutboundPaused: async () => paused,
      async setWritesStopped(stopped) {
        writesStopped = stopped;
      },
      areWritesStopped: async () => writesStopped,
      endOtherConnections: async () => 3,
      listAccountDeletionIntentRecords: async () => intents,
      async reapplyDeletionRecord(record) {
        applied.push(`${record.subjectKind}:${record.subjectId}`);
        const subjects = record.subjectKind === "account" ? accounts : households;
        if (record.subjectId === "refused") throw new Error("never dissolved");
        return { status: subjects.delete(record.subjectId) ? "purged" : "absent" };
      },
      isDeletionSubjectPresent: async (record) =>
        (record.subjectKind === "account" ? accounts : households).has(record.subjectId),
      async findRecordedOperatorActions({ kind, actionIds }) {
        if (kind === "legal-hold") return null;
        const recorded = new Set(options.recorded?.[kind] ?? []);
        return new Set(actionIds.filter((id) => recorded.has(id)));
      },
      async recordRestoredEmailFences(fences) {
        for (const fence of fences) emailFences.add(fence.digest);
      },
      countRestoredEmailFences: async (digests) =>
        digests.filter((digest) => emailFences.has(digest)).length,
      async markFencedExportJobs(fences) {
        const digests = new Set(fences.map((fence) => fence.digest));
        const marked = exportJobs.filter(
          (job) => !job.done && digests.has(effectFenceDigest(job.key)),
        );
        for (const job of marked) job.done = true;
        return marked.length;
      },
      countFencedUnfinishedExportJobs: async (digests) =>
        exportJobs.filter((job) => !job.done && digests.includes(effectFenceDigest(job.key)))
          .length,
      async deleteAllSessions() {
        const deleted = sessions;
        sessions = 0;
        return deleted;
      },
      countSessions: async () => sessions,
    },
    sessionCache: {
      async deleteAll() {
        const deleted = redisSessions;
        redisSessions = 0;
        return deleted;
      },
      count: async () => redisSessions,
    },
    reconcileStripe: async () => options.stripe ?? STRIPE_RAN,
    now: () => new Date(clockMs),
    async sleep(ms) {
      clockMs += ms;
    },
  };

  return {
    deps,
    journal(record: RecoveryJournalRecord) {
      const entry = recoveryJournalEntry(record);
      blobs.set(entry.pathname, entry.body);
      return entry.pathname;
    },
    journalLate(record: RecoveryJournalRecord) {
      late.push(recoveryJournalEntry(record));
    },
    fence(effect: "email" | "export", key: string, minutes: number) {
      blobs.set(effectFenceEntry({ effect, key, at: at(minutes) }).pathname, "{}");
    },
    blob(pathname: string, body: string) {
      blobs.set(pathname, body);
    },
    blobs,
    listings,
    applied,
    accounts,
    households,
    exportJobs,
    signIn() {
      redisSessions += 1;
    },
  };
}

describe("holding outbound and stopping writes", () => {
  it("pauses and resumes outbound on the database the step is pointed at", async () => {
    const restore = createRestore();

    await expect(pauseOutbound(restore.deps)).resolves.toEqual({ ok: true });
    await expect(restore.deps.database.isOutboundPaused()).resolves.toBe(true);
    await expect(resumeOutbound(restore.deps)).resolves.toEqual({ ok: true });
    await expect(restore.deps.database.isOutboundPaused()).resolves.toBe(false);
  });

  it("stops writes with outbound held, ends open connections, and can undo it", async () => {
    const restore = createRestore();

    await expect(stopWrites(restore.deps)).resolves.toEqual({
      ok: true,
      endedConnections: 3,
      journaledIntents: 0,
    });
    await expect(restore.deps.database.isOutboundPaused()).resolves.toBe(true);
    await expect(restore.deps.database.areWritesStopped()).resolves.toBe(true);

    await expect(resumeWrites(restore.deps)).resolves.toEqual({ ok: true });
    await expect(restore.deps.database.areWritesStopped()).resolves.toBe(false);
  });

  it("journals every committed deletion, so one whose journal write failed survives the swap", async () => {
    const unjournaled = deletion("account", "pending", 1);
    const restore = createRestore({ accounts: ["pending"], intents: [unjournaled] });

    await expect(stopWrites(restore.deps)).resolves.toMatchObject({ journaledIntents: 1 });
    await expect(stopWrites(restore.deps)).resolves.toMatchObject({ journaledIntents: 1 });

    expect([...restore.blobs.keys()]).toEqual([recoveryJournalEntry(unjournaled).pathname]);
    await expect(applyDeletionRecords(restore.deps)).resolves.toMatchObject({ purged: 1 });
  });
});

describe("the cutover marker", () => {
  it("is written once and reports how long it took to become listable", async () => {
    const restore = createRestore();
    const list = restore.deps.journal.list;
    let hidden = 2;
    restore.deps.journal.list = async (prefix) => (hidden-- > 0 ? [] : list(prefix));

    const report = await writeCutoverMarker(restore.deps, { pollMs: 1000 });

    expect(report).toEqual({
      ok: true,
      marker: "journal/_cutover/2026-10-01T12:00:00.000Z.json",
      listableAfterMs: 2000,
    });
    expect([...restore.blobs.keys()]).toEqual([report.marker]);
  });

  it("is not ok when it never becomes listable", async () => {
    const restore = createRestore();
    restore.deps.journal.list = async () => [];

    await expect(
      writeCutoverMarker(restore.deps, { timeoutMs: 3000, pollMs: 1000 }),
    ).resolves.toMatchObject({ ok: false, waitedMs: 3000 });
  });
});

describe("applying Deletion Records", () => {
  it("purges every subject through its kind's path, oldest first", async () => {
    const restore = createRestore({ accounts: ["u1", "u2"], households: ["h1"] });
    restore.journal(deletion("household", "h1", 2));
    restore.journal(deletion("account", "u2", 1));
    restore.journal(deletion("account", "u1", 3));

    const report = await applyDeletionRecords(restore.deps);

    expect(restore.applied).toEqual(["account:u2", "household:h1", "account:u1"]);
    expect(report).toMatchObject({ ok: true, records: 3, purged: 3, absent: 0 });
    expect(restore.accounts.size + restore.households.size).toBe(0);
  });

  it("is idempotent: a second run finds every subject already gone", async () => {
    const restore = createRestore({ accounts: ["u1"] });
    restore.journal(deletion("account", "u1", 1));

    await applyDeletionRecords(restore.deps);
    const again = await applyDeletionRecords(restore.deps);

    expect(again).toMatchObject({ ok: true, purged: 0, absent: 1 });
  });

  it("lists again until nothing new appears, so a late record is applied too", async () => {
    const restore = createRestore({ accounts: ["u1", "late"] });
    restore.journal(deletion("account", "u1", 1));
    restore.journalLate(deletion("account", "late", 9));

    const report = await applyDeletionRecords(restore.deps);

    expect(report).toMatchObject({ ok: true, records: 2, passes: 2, purged: 2 });
    expect(restore.accounts.has("late")).toBe(false);
  });

  it("reports a record it could not apply and a blob it did not write, and goes on", async () => {
    const restore = createRestore({ accounts: ["u1"], households: ["refused"] });
    const refused = restore.journal(deletion("household", "refused", 1));
    restore.journal(deletion("account", "u1", 2));
    restore.blob("journal/deletion/2026-10-01T12:05:00.000Z-account-x.json", "not a record");

    const report = await applyDeletionRecords(restore.deps);

    expect(report).toMatchObject({
      ok: false,
      purged: 1,
      failed: [{ pathname: refused, error: "never dissolved" }],
      unreadable: ["journal/deletion/2026-10-01T12:05:00.000Z-account-x.json"],
    });
  });
});

describe("reconciling admission", () => {
  it("replays Stripe and lists the Operator Actions the restored data has no record of, for the operator", async () => {
    const restore = createRestore({ recorded: { suspension: ["s-1"] } });
    restore.journal({ kind: "suspension", accountId: "u1", actionId: "s-1", at: at(1) });
    restore.journal({ kind: "termination", accountId: "u2", actionId: "t-1", at: at(5) });
    restore.journal({ kind: "suspension-lift", accountId: "u1", actionId: "s-1", at: at(3) });

    const report = await reconcileAdmission(restore.deps);

    expect(report).toMatchObject({
      ok: true,
      stripe: STRIPE_RAN,
      missing: [
        { kind: "suspension-lift", accountId: "u1", actionId: "s-1", at: at(3).toISOString() },
        { kind: "termination", accountId: "u2", actionId: "t-1", at: at(5).toISOString() },
      ],
      unchecked: [],
    });
  });

  it("omits every action already on record", async () => {
    const restore = createRestore({ recorded: { grant: ["g-1"] } });
    restore.journal({ kind: "grant", accountId: "u1", actionId: "g-1", at: at(1) });

    await expect(reconcileAdmission(restore.deps)).resolves.toMatchObject({
      ok: true,
      missing: [],
    });
  });

  it("lists a record with nothing to check it against as unchecked", async () => {
    const hold = createRestore();
    hold.journal({ kind: "legal-hold", accountId: "u1", actionId: "l-1", at: at(1) });

    await expect(reconcileAdmission(hold.deps)).resolves.toMatchObject({
      unchecked: [{ kind: "legal-hold", actionId: "l-1" }],
    });
  });

  it("copies the email fences before the Stripe replay, so a sent email is never repeated", async () => {
    const restore = createRestore();
    restore.fence("email", "admitted:in_1", 1);
    let fencedBeforeReplay = 0;
    restore.deps.reconcileStripe = async () => {
      fencedBeforeReplay = await restore.deps.database.countRestoredEmailFences([
        effectFenceDigest("admitted:in_1"),
      ]);
      return STRIPE_RAN;
    };

    await expect(reconcileAdmission(restore.deps)).resolves.toMatchObject({ ok: true });
    expect(fencedBeforeReplay).toBe(1);
  });

  it("does not replay Stripe when the fences cannot all be read", async () => {
    const restore = createRestore();
    restore.blob("fence/email/not-a-fence.json", "{}");
    let replayed = false;
    restore.deps.reconcileStripe = async () => {
      replayed = true;
      return STRIPE_RAN;
    };

    await expect(reconcileAdmission(restore.deps)).resolves.toMatchObject({ ok: false });
    expect(replayed).toBe(false);
  });

  it("is not ok when Stripe did not run cleanly", async () => {
    const skipped = createRestore({ stripe: { status: "skipped" } });
    await expect(reconcileAdmission(skipped.deps)).resolves.toMatchObject({ ok: false });

    const failed = createRestore({ stripe: { ...STRIPE_RAN, failed: 1 } });
    await expect(reconcileAdmission(failed.deps)).resolves.toMatchObject({ ok: false });
  });
});

describe("marking fenced effects complete", () => {
  it("copies every email fence and marks the export jobs a fence names", async () => {
    const restore = createRestore({
      exportJobs: [
        { id: "delivered", key: "u1:request-1" },
        { id: "never-ran", key: "u1:request-2" },
      ],
    });
    restore.fence("email", "admitted:in_1", 1);
    restore.fence("email", "refund:r_1", 2);
    restore.fence("export", "u1:request-1", 3);

    const report = await markFencedEffects(restore.deps);
    const again = await markFencedEffects(restore.deps);

    expect(report).toEqual({
      ok: true,
      emailFences: 2,
      exportFences: 1,
      exportJobsMarked: 1,
      unreadable: [],
    });
    expect(restore.exportJobs.map((job) => job.done)).toEqual([true, false]);
    expect(again).toMatchObject({ ok: true, exportJobsMarked: 0 });
  });
});

describe("invalidating sessions", () => {
  it("ends every session in both stores and confirms none is left", async () => {
    const restore = createRestore({ sessions: 4, redisSessions: 7 });

    await expect(invalidateSessions(restore.deps)).resolves.toEqual({
      ok: true,
      deleted: { database: 4, redis: 7 },
      remaining: { database: 0, redis: 0 },
    });
  });

  it("is not ok when a session is still there when it checks", async () => {
    const restore = createRestore({ redisSessions: 2 });
    const deleteAll = restore.deps.sessionCache.deleteAll;
    restore.deps.sessionCache.deleteAll = async () => {
      const deleted = await deleteAll();
      restore.signIn();
      return deleted;
    };

    await expect(invalidateSessions(restore.deps)).resolves.toMatchObject({
      ok: false,
      remaining: { database: 0, redis: 1 },
    });
  });
});

describe("verifying the restore", () => {
  it("passes once every scripted step has run, in the runbook's order", async () => {
    const restore = createRestore({
      accounts: ["u1", "kept"],
      households: ["h1"],
      exportJobs: [{ id: "delivered", key: "u1:request-1" }],
      sessions: 2,
      redisSessions: 2,
    });
    restore.journal(deletion("account", "u1", 1));
    restore.journal(deletion("household", "h1", 2));
    restore.fence("email", "admitted:in_1", 1);
    restore.fence("export", "u1:request-1", 2);

    for (const step of [
      "pause-outbound",
      "apply-deletions",
      "mark-fences",
      "reconcile-admission",
      "invalidate-sessions",
    ] as const) {
      await expect(runRestoreStep(restore.deps, step)).resolves.toMatchObject({ ok: true });
    }
    const report = await verifyRestore(restore.deps);

    expect(report.ok).toBe(true);
    expect(restore.accounts.has("kept")).toBe(true);
  });

  it("counts email fences by key, so a send fenced twice still verifies", async () => {
    const restore = createRestore();
    restore.fence("email", "admitted:in_1", 1);
    restore.fence("email", "admitted:in_1", 2);
    await pauseOutbound(restore.deps);
    await markFencedEffects(restore.deps);

    await expect(verifyRestore(restore.deps)).resolves.toMatchObject({ ok: true });
  });

  it("fails the fence checks on a fence it cannot read", async () => {
    const restore = createRestore();
    await pauseOutbound(restore.deps);
    restore.blob("fence/email/not-a-fence.json", "{}");
    restore.blob("fence/export/not-a-fence.json", "{}");

    const report = await verifyRestore(restore.deps);

    expect(
      (report.checks as { check: string; ok: boolean }[])
        .filter((check) => !check.ok)
        .map((check) => check.check),
    ).toEqual(["every email fence is marked complete", "no fenced export job is left to run"]);
  });

  it("names every check that fails", async () => {
    const restore = createRestore({ accounts: ["u1"], redisSessions: 1 });
    restore.journal(deletion("account", "u1", 1));
    restore.fence("email", "admitted:in_1", 1);
    await restore.deps.database.setWritesStopped(true);

    const report = await verifyRestore(restore.deps);

    expect(report.ok).toBe(false);
    expect(
      (report.checks as { check: string; ok: boolean }[])
        .filter((check) => !check.ok)
        .map((check) => check.check),
    ).toEqual([
      "outbound is paused",
      "the database accepts writes",
      "every Deletion Record's subject is gone",
      "every email fence is marked complete",
      "no session survives",
    ]);
  });
});
