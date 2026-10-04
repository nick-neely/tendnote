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

/** The Operator Actions a restore reconciles admission against. */
export type OperatorRecordKind =
  | "suspension"
  | "termination"
  | "legal-hold"
  | "grant"
  | "refund"
  | "suspension-credit";

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
  const at = FENCE_PATHNAME.exec(input.pathname)?.[1];
  if (!at) return false;
  return input.now.getTime() - Date.parse(at) >= RETENTION.effectFence.days * 24 * 60 * 60 * 1000;
}

const FENCE_PATHNAME = new RegExp(
  `^fence/(?:${FENCED_EFFECTS.join("|")})/(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)-`,
);

/** How long a deletion intent may stay incomplete before the operator is alerted. */
export const DELETION_INTENT_ALERT_AFTER_HOURS = 24;

export function isDeletionIntentStuck(input: { requestedAt: Date; now: Date }): boolean {
  return (
    input.now.getTime() - input.requestedAt.getTime() >=
    DELETION_INTENT_ALERT_AFTER_HOURS * 60 * 60 * 1000
  );
}
