import type { RecoveryJournalStore } from "@tendnote/db/queries/recovery-journal";
import {
  CUTOVER_MARKER_PREFIX,
  cutoverMarkerEntry,
  type DeletionRecord,
  type FencedEffect,
  OPERATOR_RECORD_KINDS,
  type OperatorRecord,
  type OperatorRecordKind,
  parseEffectFencePathname,
  parseRecoveryJournalEntry,
  type RecoveryJournalRecord,
  type RestoredFence,
  recoveryJournalEntry,
  recoveryJournalPrefix,
} from "@tendnote/domain";
import type { StripeReconciliationResult } from "@/lib/billing/stripe-reconciliation";
import { type OperatorRecordRestore, rerecordingFor } from "./rerecord";

/**
 * The scripted steps of a whole-service restore (#623, ADR 0250), each one
 * safe to run again. The runbook (`docs/operations/restore.md`) says when to
 * run each and against which database: `DATABASE_URL` names the branch a step
 * acts on, and the Recovery Journal, Redis, and Stripe are always production's
 * own, since a restore rolls back none of them.
 *
 * Every step reports what it did and `ok`, which is false whenever the
 * operator has something to look at before going on.
 */
export type RestoreDependencies = {
  journal: RecoveryJournalStore;
  database: {
    pauseOutbound: (input: { at: Date }) => Promise<void>;
    resumeOutbound: () => Promise<void>;
    isOutboundPaused: () => Promise<boolean>;
    setWritesStopped: (stopped: boolean) => Promise<void>;
    areWritesStopped: () => Promise<boolean>;
    endOtherConnections: () => Promise<number>;
    listAccountDeletionIntentRecords: () => Promise<DeletionRecord[]>;
    reapplyDeletionRecord: (record: DeletionRecord) => Promise<{ status: "purged" | "absent" }>;
    isDeletionSubjectPresent: (record: DeletionRecord) => Promise<boolean>;
    findRecordedOperatorActions: (input: {
      kind: OperatorRecordKind;
      actionIds: string[];
    }) => Promise<Set<string> | null>;
    recordRestoredEmailFences: (fences: RestoredFence[]) => Promise<void>;
    countRestoredEmailFences: (digests: string[]) => Promise<number>;
    markFencedExportJobs: (fences: RestoredFence[]) => Promise<number>;
    countFencedUnfinishedExportJobs: (digests: string[]) => Promise<number>;
    deleteAllSessions: () => Promise<number>;
    countSessions: () => Promise<number>;
  };
  /** The Redis session store every deployment shares. */
  sessionCache: {
    deleteAll: () => Promise<number>;
    count: () => Promise<number>;
  };
  /** Re-records an Operator Action the restored data lost (#723). */
  operatorRecords: OperatorRecordRestore;
  reconcileStripe: () => Promise<StripeReconciliationResult>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

type Report = { ok: boolean } & Record<string, unknown>;

function clock(deps: RestoreDependencies) {
  return deps.now ?? (() => new Date());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Holds the cron, the queues, push, and email on the database `DATABASE_URL`
 * names. Run first on a new restore branch, before anything else connects.
 */
export async function pauseOutbound(deps: RestoreDependencies): Promise<Report> {
  await deps.database.pauseOutbound({ at: clock(deps)() });
  return { ok: await deps.database.isOutboundPaused() };
}

/**
 * Stops production writes: holds outbound, makes every new connection
 * read-only, and ends the open ones so they reconnect read-only. A write that
 * was in flight either committed before or rolled back; any journal write it
 * started is caught by the cutover drain.
 *
 * Then it journals every account deletion intent still committed. One whose
 * journal write had failed would otherwise be lost with production's rows at
 * the swap, and the account would come back. A record already written is
 * written again as a no-op, since it is timed at the request.
 */
export async function stopWrites(deps: RestoreDependencies): Promise<Report> {
  await deps.database.pauseOutbound({ at: clock(deps)() });
  await deps.database.setWritesStopped(true);
  const endedConnections = await deps.database.endOtherConnections();
  const intents = await deps.database.listAccountDeletionIntentRecords();
  for (const record of intents) await deps.journal.write(recoveryJournalEntry(record));
  return {
    ok: await deps.database.areWritesStopped(),
    endedConnections,
    journaledIntents: intents.length,
  };
}

/** Undoes {@link stopWrites}'s read-only mode, for a restore that is abandoned. */
export async function resumeWrites(deps: RestoreDependencies): Promise<Report> {
  await deps.database.setWritesStopped(false);
  return { ok: !(await deps.database.areWritesStopped()) };
}

/**
 * Writes the cutover marker and waits until a listing shows it, which also
 * measures how long a new blob takes to become listable: a figure the drill
 * records rather than assumes.
 */
export async function writeCutoverMarker(
  deps: RestoreDependencies,
  input: { timeoutMs?: number; pollMs?: number } = {},
): Promise<Report> {
  const now = clock(deps);
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = input.timeoutMs ?? 5 * 60 * 1000;
  const pollMs = input.pollMs ?? 1000;

  const writtenAt = now();
  const marker = cutoverMarkerEntry(writtenAt);
  await deps.journal.write(marker);
  for (;;) {
    const waitedMs = now().getTime() - writtenAt.getTime();
    if ((await deps.journal.list(CUTOVER_MARKER_PREFIX)).includes(marker.pathname)) {
      return { ok: true, marker: marker.pathname, listableAfterMs: waitedMs };
    }
    if (waitedMs >= timeoutMs) return { ok: false, marker: marker.pathname, waitedMs };
    await sleep(pollMs);
  }
}

/** The records these pathnames hold, and the pathnames that held none. */
async function readEntries(deps: RestoreDependencies, pathnames: string[]) {
  const records: { pathname: string; record: RecoveryJournalRecord }[] = [];
  const unreadable: string[] = [];
  for (const pathname of pathnames) {
    const entry = await deps.journal.read(pathname);
    const record = entry && parseRecoveryJournalEntry(entry);
    if (record) records.push({ pathname, record });
    else unreadable.push(pathname);
  }
  return { records, unreadable };
}

/**
 * Applies every Deletion Record in the journal, oldest first, through its
 * kind's own purge path. Every record is applied whatever its time, because a
 * subject someone asked to delete stays deleted. It lists again after each
 * pass until a listing shows nothing new, which picks up a record that became
 * listable late; running the step again later is just as safe.
 */
export async function applyDeletionRecords(deps: RestoreDependencies): Promise<Report> {
  const seen = new Set<string>();
  const tally: DeletionTally = { purged: 0, absent: 0, failed: [], unreadable: [] };
  let passes = 0;

  for (;;) {
    const fresh = (await deps.journal.list(recoveryJournalPrefix("deletion"))).filter(
      (pathname) => !seen.has(pathname),
    );
    if (fresh.length === 0) break;
    passes += 1;
    for (const pathname of fresh) seen.add(pathname);
    await applyDeletionPass(deps, fresh, tally);
  }

  return {
    ok: tally.failed.length === 0 && tally.unreadable.length === 0,
    records: seen.size,
    passes,
    ...tally,
  };
}

type DeletionTally = {
  purged: number;
  absent: number;
  failed: { pathname: string; error: string }[];
  unreadable: string[];
};

/** Applies one listing's new records, oldest first, counting each outcome. */
async function applyDeletionPass(
  deps: RestoreDependencies,
  pathnames: string[],
  tally: DeletionTally,
): Promise<void> {
  const read = await readEntries(deps, pathnames);
  tally.unreadable.push(...read.unreadable);
  for (const { pathname, record } of read.records) {
    if (record.kind !== "deletion") {
      tally.unreadable.push(pathname);
      continue;
    }
    try {
      const { status } = await deps.database.reapplyDeletionRecord(record);
      tally[status] += 1;
    } catch (error) {
      tally.failed.push({ pathname, error: errorMessage(error) });
    }
  }
}

/** Every operator record in the journal, by kind, with any that could not be read. */
async function readOperatorRecords(deps: RestoreDependencies) {
  const byKind = new Map<OperatorRecordKind, OperatorRecord[]>();
  const unreadable: string[] = [];
  for (const kind of OPERATOR_RECORD_KINDS) {
    const read = await readEntries(deps, await deps.journal.list(recoveryJournalPrefix(kind)));
    unreadable.push(...read.unreadable);
    byKind.set(
      kind,
      read.records.flatMap(({ record }) => (record.kind === kind ? [record] : [])),
    );
  }
  return { byKind, unreadable };
}

/** The journaled Operator Actions the restored data holds no record of, and those it cannot check. */
async function findUnrecorded(
  deps: RestoreDependencies,
  byKind: Map<OperatorRecordKind, OperatorRecord[]>,
) {
  const missing: OperatorRecord[] = [];
  const unchecked: OperatorRecord[] = [];
  for (const [kind, records] of byKind) {
    if (records.length === 0) continue;
    const recorded = await deps.database.findRecordedOperatorActions({
      kind,
      actionIds: records.map((record) => record.actionId),
    });
    for (const record of records) {
      if (!recorded) unchecked.push(record);
      else if (!recorded.has(record.actionId)) missing.push(record);
    }
  }
  return { missing: missing.sort(byTime), unchecked: unchecked.sort(byTime) };
}

function byTime(a: OperatorRecord, b: OperatorRecord) {
  return a.at.getTime() - b.at.getTime();
}

function show(record: OperatorRecord) {
  return { ...record, at: record.at.toISOString() };
}

/**
 * Re-records, oldest first, each missing action whose kind cannot safely be run
 * again (#723), so a termination is on record before the credit it converted.
 */
async function rerecordMissing(deps: RestoreDependencies, missing: OperatorRecord[]) {
  const rerecorded: OperatorRecord[] = [];
  const failed: (OperatorRecord & { error: string })[] = [];
  for (const record of missing) {
    const rerecord = rerecordingFor(record.kind);
    if (!rerecord) continue;
    try {
      if (await rerecord(deps.operatorRecords, record)) rerecorded.push(record);
    } catch (error) {
      failed.push({ ...record, error: errorMessage(error) });
    }
  }
  return { rerecorded, failed };
}

/**
 * Reconciles admission: re-records the Operator Actions the restored data lost
 * that cannot safely be run again, replays Stripe through the reconciliation
 * job, then lists every journaled Operator Action the restored database still
 * has no record of, oldest first. Those happened after the restore point.
 *
 * A termination, lift, refund, or Suspension Credit is re-recorded under the
 * journal's own id and time, from the journal and the Stripe object that
 * carries the record, with no Stripe write (#723). Re-recording comes before
 * the replay, so a re-recorded refund is matched rather than alerted on. What
 * cannot be re-recorded stays listed: a journal record is content-free, so the
 * operator handles it from the runbook, and nothing here guesses a reason or
 * moves money. A re-performed action is a new record under a new id, so the
 * list never empties of those: `ok` says the step itself ran cleanly, and every
 * entry in `missing` and `unchecked` is the operator's.
 */
export async function reconcileAdmission(deps: RestoreDependencies): Promise<Report> {
  // The replay may try an email that already went before the restore; with
  // its fence copied first, that send completes silently. Copying is
  // idempotent, so running it here makes the order impossible to get wrong.
  const fences = await markFencedEffects(deps);
  if (!fences.ok) return { ok: false, fences };
  const { byKind, unreadable } = await readOperatorRecords(deps);
  const restored = await rerecordMissing(deps, (await findUnrecorded(deps, byKind)).missing);
  const stripe = await deps.reconcileStripe();
  const { missing, unchecked } = await findUnrecorded(deps, byKind);

  return {
    ok:
      stripe.status === "ran" &&
      stripe.failed === 0 &&
      unreadable.length === 0 &&
      restored.failed.length === 0,
    stripe,
    rerecorded: restored.rerecorded.map(show),
    rerecordFailed: restored.failed.map(show),
    missing: missing.map(show),
    unchecked: unchecked.map(show),
    unreadable,
  };
}

/** Every fence of one effect still in the store, read from its pathname. */
async function listFences(deps: RestoreDependencies, effect: FencedEffect) {
  const fences: RestoredFence[] = [];
  const unreadable: string[] = [];
  for (const pathname of await deps.journal.list(`fence/${effect}/`)) {
    const fence = parseEffectFencePathname(pathname);
    if (fence?.effect === effect) fences.push({ digest: fence.digest, fencedAt: fence.at });
    else unreadable.push(pathname);
  }
  return { fences, unreadable };
}

/**
 * Marks every fenced effect complete in the restored database (#620): each
 * email fence is copied in, so the send completes without sending whichever
 * job or transition repeats it, and each restored export job a fence names is
 * marked delivered.
 */
export async function markFencedEffects(deps: RestoreDependencies): Promise<Report> {
  const email = await listFences(deps, "email");
  const exports = await listFences(deps, "export");
  await deps.database.recordRestoredEmailFences(email.fences);
  const exportJobsMarked = await deps.database.markFencedExportJobs(exports.fences);
  const unreadable = [...email.unreadable, ...exports.unreadable];
  return {
    ok: unreadable.length === 0,
    emailFences: email.fences.length,
    exportFences: exports.fences.length,
    exportJobsMarked,
    unreadable,
  };
}

/**
 * Ends every session in the auth store and in Redis, then confirms by query
 * that none is left in either.
 */
export async function invalidateSessions(deps: RestoreDependencies): Promise<Report> {
  const deleted = {
    database: await deps.database.deleteAllSessions(),
    redis: await deps.sessionCache.deleteAll(),
  };
  const remaining = {
    database: await deps.database.countSessions(),
    redis: await deps.sessionCache.count(),
  };
  return { ok: remaining.database === 0 && remaining.redis === 0, deleted, remaining };
}

type Check = { check: string; ok: boolean; detail?: unknown };

/**
 * Checks the restored database before the swap, and production after it: each
 * scripted step's outcome, read back rather than taken from its report.
 */
export async function verifyRestore(deps: RestoreDependencies): Promise<Report> {
  const checks: Check[] = [];

  checks.push({ check: "outbound is paused", ok: await deps.database.isOutboundPaused() });
  checks.push({
    check: "the database accepts writes",
    ok: !(await deps.database.areWritesStopped()),
  });

  const deletions = await readEntries(
    deps,
    await deps.journal.list(recoveryJournalPrefix("deletion")),
  );
  const present: string[] = [];
  for (const { pathname, record } of deletions.records) {
    if (record.kind === "deletion" && (await deps.database.isDeletionSubjectPresent(record))) {
      present.push(pathname);
    }
  }
  checks.push({
    check: "every Deletion Record's subject is gone",
    ok: present.length === 0 && deletions.unreadable.length === 0,
    detail: { records: deletions.records.length, present, unreadable: deletions.unreadable },
  });

  const email = await listFences(deps, "email");
  // A send retried after an uncertain failure can be fenced twice, so the
  // fences are counted by key.
  const digests = [...new Set(email.fences.map((fence) => fence.digest))];
  const copied = await deps.database.countRestoredEmailFences(digests);
  checks.push({
    check: "every email fence is marked complete",
    ok: copied === digests.length && email.unreadable.length === 0,
    detail: { keys: digests.length, copied, unreadable: email.unreadable },
  });

  const exports = await listFences(deps, "export");
  const unfinished = await deps.database.countFencedUnfinishedExportJobs(
    exports.fences.map((fence) => fence.digest),
  );
  checks.push({
    check: "no fenced export job is left to run",
    ok: unfinished === 0 && exports.unreadable.length === 0,
    detail: { unfinished, unreadable: exports.unreadable },
  });

  const sessions = {
    database: await deps.database.countSessions(),
    redis: await deps.sessionCache.count(),
  };
  checks.push({
    check: "no session survives",
    ok: sessions.database === 0 && sessions.redis === 0,
    detail: sessions,
  });

  return { ok: checks.every((check) => check.ok), checks };
}

/** Releases the cron, the queues, push, and email: the last step. */
export async function resumeOutbound(deps: RestoreDependencies): Promise<Report> {
  await deps.database.resumeOutbound();
  return { ok: !(await deps.database.isOutboundPaused()) };
}

const STEPS = {
  "pause-outbound": pauseOutbound,
  "stop-writes": stopWrites,
  "resume-writes": resumeWrites,
  cutover: writeCutoverMarker,
  "apply-deletions": applyDeletionRecords,
  "reconcile-admission": reconcileAdmission,
  "mark-fences": markFencedEffects,
  "invalidate-sessions": invalidateSessions,
  verify: verifyRestore,
  "resume-outbound": resumeOutbound,
} satisfies Record<string, (deps: RestoreDependencies) => Promise<Report>>;

export type RestoreStep = keyof typeof STEPS;

export function isRestoreStep(name: string | undefined): name is RestoreStep {
  return name !== undefined && Object.hasOwn(STEPS, name);
}

export function runRestoreStep(deps: RestoreDependencies, step: RestoreStep): Promise<Report> {
  return STEPS[step](deps);
}

export const RESTORE_STEPS = Object.keys(STEPS) as RestoreStep[];
