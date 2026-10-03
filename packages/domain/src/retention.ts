/**
 * Every retention period Tendnote promises, held once.
 *
 * The Privacy Policy's retention table is generated from these values, and
 * every sweep that deletes data reads its period from here (the ADR 0221
 * pattern), so what the policy promises and what actually gets deleted cannot
 * drift apart. Today the household purge, audit, and account funnel retention
 * sweeps and the Lapsed retention deadline read it; the Lapsed, Deletion Record,
 * fence, and anonymous daily total sweeps must when built. Changing a value here is a
 * reviewed change to a published promise: the committed table in
 * `docs/legal/privacy-retention-table.md` fails its test until it is
 * regenerated from here.
 */
export const RETENTION = {
  /** Content of a Lapsed account, counted from entering Lapsed. */
  lapsedAccount: { days: 90 },
  /** The Backup Window (ADR 0250): recovery and the deletion tail in one bound. */
  backupWindow: { days: 7 },
  /** A Deletion Record in the Recovery Journal. */
  deletionRecord: { days: 30 },
  /** A fence that stops a restore from re-sending email or re-running an export. */
  deletionFence: { days: 14 },
  /** Account-linked funnel events, or sooner when the account is deleted. */
  accountLinkedFunnelEvents: { days: 90 },
  anonymousDailyTotals: { months: 13 },
  usageLedger: { months: 13 },
  supportEmail: { years: 2 },
  /** Counted from the incident's closure. */
  incidentRecord: { years: 3 },
  /** A dissolved household's recovery window, which is also its purge deadline (ADR 0221). */
  householdRecoveryWindow: { days: 30 },
  /** The audit log's default policy (ADR 0223). */
  auditLog: { years: 2 },
} as const;

export type RetentionKey = keyof typeof RETENTION;

type RetentionPeriod = { days: number } | { months: number } | { years: number };

function formatPeriod(period: RetentionPeriod): string {
  const [unit, amount] = Object.entries(period)[0] as [string, number];
  const singular = unit.slice(0, -1);
  return `${amount} ${amount === 1 ? singular : unit}`;
}

type RetentionTableRow = {
  data: string;
  retained: (period: (key: RetentionKey) => string) => string;
};

/**
 * The rows of the Privacy Policy's retention table, in reading order.
 *
 * Wording follows the hosted-privacy decision artifact; each number is read
 * from {@link RETENTION} rather than typed into the sentence.
 */
const RETENTION_TABLE_ROWS: readonly RetentionTableRow[] = [
  {
    data: "Active account content",
    retained: () => "While the account exists",
  },
  {
    data: "Lapsed account content",
    retained: (p) => `${p("lapsedAccount")} from entering Lapsed, then deleted`,
  },
  {
    data: "Deleted account",
    retained: (p) =>
      `The account closes at once and its content leaves the live database within minutes; residual backup copies expire within the Backup Window of ${p("backupWindow")}, and a restore never brings it back`,
  },
  {
    data: "Deletion Records",
    retained: (p) =>
      `${p("deletionRecord")}; the restore fences for email and export, ${p("deletionFence")}. Neither holds content`,
  },
  {
    data: "Shared household records after the household ends",
    retained: (p) =>
      `${p("householdRecoveryWindow")} after the household ends, then deleted; what each member wrote privately stays theirs`,
  },
  {
    data: "Billing records",
    retained: () =>
      "Held by Stripe and the operator for the period tax law requires; never contain content",
  },
  {
    data: "Usage records",
    retained: (p) => `${p("usageLedger")}; content-free`,
  },
  {
    data: "Support email",
    retained: (p) => p("supportEmail"),
  },
  {
    data: "Audit log",
    retained: (p) => p("auditLog"),
  },
  {
    data: "Incident records",
    retained: (p) => `${p("incidentRecord")} from closure`,
  },
  {
    data: "Optional telemetry",
    retained: (p) =>
      `Account-linked funnel events erased on deletion or after ${p("accountLinkedFunnelEvents")}; anonymous daily totals ${p("anonymousDailyTotals")}`,
  },
];

/** Every constant the published table actually states, read from its rows. */
export function publishedRetentionKeys(): RetentionKey[] {
  const stated: RetentionKey[] = [];
  for (const row of RETENTION_TABLE_ROWS) {
    row.retained((key) => {
      stated.push(key);
      return "";
    });
  }
  return stated;
}

/** The retention table as published Markdown. */
export function renderRetentionTable(): string {
  const period = (key: RetentionKey) => formatPeriod(RETENTION[key]);
  const rows = RETENTION_TABLE_ROWS.map((row) => `| ${row.data} | ${row.retained(period)} |`);

  return [
    "<!-- Generated from packages/domain/src/retention.ts. Do not edit by hand. -->",
    "",
    "# Retention",
    "",
    "| Data | Retained |",
    "| --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
