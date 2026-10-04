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
  | "suspension-lift"
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

/** How long a deletion intent may stay incomplete before the operator is alerted. */
export const DELETION_INTENT_ALERT_AFTER_HOURS = 24;

export function isDeletionIntentStuck(input: { requestedAt: Date; now: Date }): boolean {
  return (
    input.now.getTime() - input.requestedAt.getTime() >=
    DELETION_INTENT_ALERT_AFTER_HOURS * 60 * 60 * 1000
  );
}
