import {
  type RecoveryJournal,
  type RecoveryJournalRecord,
  recoveryJournalEntry,
} from "@tendnote/domain";

/**
 * The Recovery Journal without Vercel Blob, keeping the one property the real
 * store gives for free: a pathname is written once, and writing it again is a
 * no-op rather than an overwrite.
 */
export function createInMemoryRecoveryJournal(options: { steps?: string[] } = {}) {
  const steps = options.steps ?? [];
  const entries = new Map<string, string>();
  let failures = 0;

  const pathnames = () => [...entries.keys()].sort();

  const journal: RecoveryJournal = {
    async write(record: RecoveryJournalRecord) {
      if (failures > 0) {
        failures -= 1;
        throw new Error("Simulated Recovery Journal outage.");
      }
      const entry = recoveryJournalEntry(record);
      if (!entries.has(entry.pathname)) entries.set(entry.pathname, entry.body);
      steps.push(`journal:${subjectOf(record)}`);
    },
  };

  return {
    ...journal,
    failNextWrites(count: number) {
      failures = count;
    },
    pathnames,
    records() {
      return pathnames().map((pathname) => JSON.parse(entries.get(pathname) ?? "null"));
    },
  };
}

function subjectOf(record: RecoveryJournalRecord): string {
  return record.kind === "deletion" ? record.subjectId : record.accountId;
}
