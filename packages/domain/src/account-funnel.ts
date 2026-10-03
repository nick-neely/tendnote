import { ACTIVATION_MILESTONES } from "./activation-milestones";
import { RETENTION } from "./retention";

/**
 * The closed set of account funnel stages, in funnel order: the hosted
 * telemetry decision's account events. Payment and admission are read from
 * server state, never a browser redirect, and the last five are the Activation
 * Milestones (ADR 0242), copied here only for an account that is collecting.
 * Adding a stage changes a disclosed boundary, so the set is a literal.
 */
export const ACCOUNT_FUNNEL_STAGES = [
  "signup_completed",
  "checkout_started",
  "payment_confirmed",
  "paid_access_granted",
  ...ACTIVATION_MILESTONES,
] as const;

export type AccountFunnelStage = (typeof ACCOUNT_FUNNEL_STAGES)[number];

/** The stages a signed-in visitor's own request starts, which can enrol an account. */
export type RequestFunnelStage = Extract<
  AccountFunnelStage,
  "signup_completed" | "checkout_started"
>;

/** The stages Tendnote's own server state confirms, after the account has enrolled. */
export type ServerFunnelStage = Exclude<AccountFunnelStage, RequestFunnelStage>;

/** The server-state stages the Paid Access projection confirms. */
export type PaidAccessFunnelStage = Extract<
  ServerFunnelStage,
  "payment_confirmed" | "paid_access_granted"
>;

/**
 * Whether optional telemetry may be collected for a request. Only a country
 * known to be the United States counts: an absent, unrecognised, or any other
 * country is suppressed, unlike the Region Block, which refuses only the
 * countries it names.
 */
export function isTelemetryEligibleCountry(country: string | null | undefined): boolean {
  return country?.trim().toUpperCase() === "US";
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Funnel events that happened before this moment are past their retention and are deleted. */
export function accountFunnelEventCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION.accountLinkedFunnelEvents.days * DAY_MS);
}

/** What the saved account funnel report reads, gathered for one window. */
export type AccountFunnelReportData = {
  since: Date;
  until: Date;
  /**
   * For the accounts whose signup completed inside the window, how many have
   * reached each stage. Each account counts once per stage however often the
   * event was delivered.
   */
  cohort: Record<AccountFunnelStage, number>;
  /** Hosted accounts created inside the window, collecting or not. */
  accountsCreated: number;
  /** Accounts whose optional telemetry is switched off today. */
  accountsOptedOut: number;
};

/** Each stage's account count from grouped rows, with a stage no account reached as zero. */
export function accountFunnelCohort(
  rows: readonly { stage: AccountFunnelStage; accounts: number }[],
): Record<AccountFunnelStage, number> {
  const cohort = Object.fromEntries(ACCOUNT_FUNNEL_STAGES.map((stage) => [stage, 0])) as Record<
    AccountFunnelStage,
    number
  >;
  for (const row of rows) cohort[row.stage] = row.accounts;
  return cohort;
}

const STAGE_LABELS: Record<AccountFunnelStage, string> = {
  signup_completed: "Signup completed",
  checkout_started: "Checkout started",
  payment_confirmed: "Payment confirmed",
  paid_access_granted: "Paid Access granted",
  first_person_created: "First person created",
  first_memory_confirmed: "First Memory confirmed",
  first_followup_scheduled: "First Follow-Up scheduled",
  first_grounded_eve_answer: "First grounded Eve answer",
  first_value_reached: "First Value reached",
};

function day(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function accounts(n: number): string {
  return `${n} ${n === 1 ? "account" : "accounts"}`;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "-" : `${Math.round((part / whole) * 100)}%`;
}

/**
 * The saved operator report, as plain text. It keeps the account funnel and
 * public activity apart, because they measure different things: one counts
 * accounts, the other anonymous page activity that is never joined to them.
 * Its coverage section says why the numbers are a floor, not a census.
 */
export function renderAccountFunnelReport(data: AccountFunnelReportData): string {
  const enrolled = data.cohort.signup_completed;
  const width = Math.max(...Object.values(STAGE_LABELS).map((label) => label.length));
  const stageLines = ACCOUNT_FUNNEL_STAGES.map(
    (stage) =>
      `  ${STAGE_LABELS[stage].padEnd(width)}  ${String(data.cohort[stage]).padStart(5)}  ${percent(data.cohort[stage], enrolled).padStart(4)}`,
  );

  return [
    `Tendnote funnel report, ${day(data.since)} to ${day(data.until)} (UTC)`,
    "",
    "ACCOUNT FUNNEL: signup to First Value",
    "Accounts whose signup completed in the window, and how many of them have",
    "reached each stage since. Each account counts once per stage.",
    "",
    ...stageLines,
    "",
    "Coverage",
    `  ${enrolled} of ${accounts(data.accountsCreated)} created in the window are in this funnel.`,
    "  The rest signed up outside a known-US region, had opted out, or their",
    "  event was not recorded. An account that first enrolled at checkout has no",
    "  signup event, so it is not in this cohort.",
    `  ${accounts(data.accountsOptedOut)} with analytics switched off today: their later`,
    "  stages are missing and are never backfilled from Activation Milestones.",
    `  Events are deleted after ${RETENTION.accountLinkedFunnelEvents.days} days, so a longer window undercounts.`,
    "  A failed or suppressed write is not retried, so every count is a floor.",
    "  This is not a billing or admission ledger: Stripe and the Access Profile",
    "  are the record of who paid and who is admitted.",
    "",
    "PUBLIC ACTIVITY",
    "Anonymous daily page counters, never joined to accounts. Their ratios are",
    "approximate activity ratios, not unique-person conversion rates.",
    "",
    "  Not collected yet.",
    "",
  ].join("\n");
}
