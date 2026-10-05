import { createHash } from "node:crypto";
import { RETENTION } from "./retention";

/**
 * The Recovery Journal: the durable store outside the product database that a
 * restore reads to re-apply every irreversible purge and reconcile admission
 * (ADR 0250). It is a recovery aid, not a second event store: product code only
 * writes it, and nothing reads it except recovery.
 *
 * Every record is content-free - identifiers and a time - and becomes one
 * immutable entry whose pathname is its identity. The pathname leads with a
 * fixed-width UTC timestamp, so listing a kind's prefix returns its records in
 * time order and a restore can drain to a known point.
 */

/** What a Deletion Record's subject is: a deleted account or a purged Household Workspace. */
export type DeletionSubjectKind = "account" | "household";

/** The fact that a subject's rows are about to be irreversibly purged. */
export type DeletionRecord = {
  kind: "deletion";
  subjectKind: DeletionSubjectKind;
  subjectId: string;
  at: Date;
};

/**
 * The Operator Actions a restore re-applies: the ones it reconciles admission
 * against, and the Account Ceiling override, which changes only pace (#633).
 */
export const OPERATOR_RECORD_KINDS = [
  "suspension",
  "suspension-lift",
  "termination",
  "legal-hold",
  "grant",
  "refund",
  "suspension-credit",
  "ceiling-override",
] as const;

export type OperatorRecordKind = (typeof OPERATOR_RECORD_KINDS)[number];

/** An Operator Action's mirror, named by the action's own id. */
export type OperatorRecord = {
  kind: OperatorRecordKind;
  accountId: string;
  actionId: string;
  at: Date;
};

export type RecoveryJournalRecord = DeletionRecord | OperatorRecord;

/**
 * The write side of the journal. `write` resolves only once the record is
 * durable, and writing a record that is already there succeeds, so a retry
 * after an uncertain failure is always safe.
 */
export type RecoveryJournal = {
  write: (record: RecoveryJournalRecord) => Promise<void>;
};

/** One journal entry as stored: where it lives and exactly what it holds. */
export type RecoveryJournalEntry = { pathname: string; body: string };

const IDENTIFIER = /^[A-Za-z0-9_-]+$/;

function segment(identifier: string): string {
  if (!IDENTIFIER.test(identifier)) {
    throw new Error("A Recovery Journal identifier must be letters, digits, '_' or '-'.");
  }
  return identifier;
}

/**
 * The entry for a record. `toISOString` is fixed-width for every date this
 * service will see, which is what makes lexicographic order time order.
 */
export function recoveryJournalEntry(record: RecoveryJournalRecord): RecoveryJournalEntry {
  const at = record.at.toISOString();
  if (record.kind === "deletion") {
    return {
      pathname: `journal/deletion/${at}-${record.subjectKind}-${segment(record.subjectId)}.json`,
      body: JSON.stringify({
        kind: record.kind,
        subjectKind: record.subjectKind,
        subjectId: record.subjectId,
        at,
      }),
    };
  }
  return {
    pathname: `journal/${record.kind}/${at}-${segment(record.accountId)}-${segment(record.actionId)}.json`,
    body: JSON.stringify({
      kind: record.kind,
      accountId: record.accountId,
      actionId: record.actionId,
      at,
    }),
  };
}

/** The prefix one kind's records are listed under, in time order. */
export function recoveryJournalPrefix(kind: RecoveryJournalRecord["kind"]): string {
  return `journal/${kind}/`;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function instant(value: unknown): Date | null {
  return typeof value === "string" && ISO_INSTANT.test(value) ? new Date(value) : null;
}

function readRecord(body: string): RecoveryJournalRecord | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const at = instant(parsed?.at);
  if (!at) return null;
  const { kind } = parsed;
  if (kind === "deletion") {
    const { subjectKind, subjectId } = parsed;
    if (subjectKind !== "account" && subjectKind !== "household") return null;
    if (typeof subjectId !== "string") return null;
    return { kind, subjectKind, subjectId, at };
  }
  if (!OPERATOR_RECORD_KINDS.includes(kind as OperatorRecordKind)) return null;
  const { accountId, actionId } = parsed;
  if (typeof accountId !== "string" || typeof actionId !== "string") return null;
  return { kind: kind as OperatorRecordKind, accountId, actionId, at };
}

/**
 * Reads a stored entry back into its record for a restore. Anything this module
 * did not write is `null`: the body must be a well-formed record that files
 * under exactly the pathname it was read from, so a stray or altered blob is
 * never applied.
 */
export function parseRecoveryJournalEntry(
  entry: RecoveryJournalEntry,
): RecoveryJournalRecord | null {
  const record = readRecord(entry.body);
  if (!record) return null;
  try {
    return recoveryJournalEntry(record).pathname === entry.pathname ? record : null;
  } catch {
    return null;
  }
}

/**
 * Where a restore's cutover marker lives. It sits outside every record kind's
 * prefix, so draining a kind never lists it.
 */
export const CUTOVER_MARKER_PREFIX = "journal/_cutover/";

/**
 * The marker a restore writes once production writes have stopped and
 * settled. Once a listing shows it, every record written before it has had as
 * long to become listable as the marker has.
 */
export function cutoverMarkerEntry(at: Date): RecoveryJournalEntry {
  const iso = at.toISOString();
  return { pathname: `${CUTOVER_MARKER_PREFIX}${iso}.json`, body: JSON.stringify({ at: iso }) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

const DELETION_PATHNAME = /^journal\/deletion\/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-/;

/**
 * Whether a Deletion Record has outlived Deletion Record Retention. Past it, no
 * backup surface can still hold the subject (ADR 0250). A pathname this module
 * did not write is never expired, so the sweep leaves anything it cannot read.
 */
export function isDeletionRecordExpired(input: { pathname: string; now: Date }): boolean {
  const at = DELETION_PATHNAME.exec(input.pathname)?.[1];
  if (!at) return false;
  return input.now.getTime() - Date.parse(at) >= RETENTION.deletionRecord.days * DAY_MS;
}

/**
 * The outbound effects a restore must not repeat: a Resend email send and an
 * owner data export delivery. Reminders are deliberately absent. They are the
 * one thing never deliberately shed, and a duplicate reminder after a restore is
 * a far smaller harm than a suppressed one (ADR 0250).
 */
export const FENCED_EFFECTS = ["email", "export"] as const;

export type FencedEffect = (typeof FENCED_EFFECTS)[number];

/**
 * The fact that an effect already left the system, written only after it
 * succeeded. `key` is the effect's existing business idempotency key; the fence
 * stores only its digest, so it stays content-free whatever the key holds, and
 * a restore matches a restored job by hashing that job's own key.
 */
export type EffectFence = { effect: FencedEffect; key: string; at: Date };

/**
 * The write side of the fences. A retry after an uncertain failure may file a
 * second fence for the same effect, which is harmless: a restore only asks
 * whether any fence names the key.
 */
export type EffectFences = {
  write: (fence: EffectFence) => Promise<void>;
};

/**
 * The key an owner data export delivery is fenced under. The job's idempotency
 * key is unique only per owner, so the fence is keyed by both.
 */
export function ownerDataExportFenceKey(input: {
  ownerUserId: string;
  idempotencyKey: string;
}): string {
  return `${input.ownerUserId}:${input.idempotencyKey}`;
}

/** A fence as a restore copies it into the restored data: its digest and when it was written. */
export type RestoredFence = { digest: string; fencedAt: Date };

/** The digest a fence is filed under, for matching a restored job against its fence. */
export function effectFenceDigest(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The prefix one effect's fences are listed under, in time order. */
export function effectFencePrefix(effect: FencedEffect): string {
  return `fence/${effect}/`;
}

/**
 * The entry for a fence: beside the journal in the same store, timestamp first
 * for the same reason, so the retention sweep can stop at the first fence it
 * must keep.
 */
export function effectFenceEntry(fence: EffectFence): RecoveryJournalEntry {
  const at = fence.at.toISOString();
  const digest = effectFenceDigest(fence.key);
  return {
    pathname: `${effectFencePrefix(fence.effect)}${at}-${digest}.json`,
    body: JSON.stringify({ effect: fence.effect, digest, at }),
  };
}

/**
 * Whether a fence has outlived its retention constant. A fence is only ever
 * consulted for effects inside the Backup Window, so past this it holds nothing
 * a restore could need. A pathname this module did not write is never expired,
 * so the sweep leaves anything it cannot read alone.
 */
export function isEffectFenceExpired(input: { pathname: string; now: Date }): boolean {
  const fence = parseEffectFencePathname(input.pathname);
  if (!fence) return false;
  return input.now.getTime() - fence.at.getTime() >= RETENTION.effectFence.days * DAY_MS;
}

const FENCE_PATHNAME = new RegExp(
  `^fence/(${FENCED_EFFECTS.join("|")})/(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)-([0-9a-f]{64})\\.json$`,
);

/** A stored fence read back from its pathname, which holds all of it; `null` if it is not one. */
export function parseEffectFencePathname(
  pathname: string,
): { effect: FencedEffect; digest: string; at: Date } | null {
  const match = FENCE_PATHNAME.exec(pathname);
  if (!match) return null;
  const [, effect, at, digest] = match as unknown as [string, FencedEffect, string, string];
  return { effect, digest, at: new Date(at) };
}

/** How long a deletion intent may stay incomplete before the operator is alerted. */
export const DELETION_INTENT_ALERT_AFTER_HOURS = 24;

/**
 * Whether an intent has stayed incomplete too long. A Service-Wide Hold makes
 * every intent wait (#634), so the clock starts at the later of the request and
 * the most recent lift.
 */
export function isDeletionIntentStuck(input: {
  requestedAt: Date;
  now: Date;
  holdLiftedAt?: Date | null;
}): boolean {
  const from = Math.max(input.requestedAt.getTime(), input.holdLiftedAt?.getTime() ?? 0);
  return input.now.getTime() - from >= DELETION_INTENT_ALERT_AFTER_HOURS * 60 * 60 * 1000;
}
