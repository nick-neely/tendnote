/**
 * Audit entries are internal evidence, never a member-facing activity feed.
 *
 * Retention is keyed by the entry's action and entity type so a future entry
 * can receive a deliberate policy without changing the storage contract. Until
 * a shorter or longer class is approved, both known and unknown entries use the
 * conservative two-calendar-year default. Expiry is a hard delete from the
 * audit table; the audit trail is not product state.
 */

export const AUDIT_LOG_DEFAULT_RETENTION_YEARS = 2;

export type AuditLogRetentionPolicy = {
  retentionYears: number;
  readAccess: "internal";
  disposal: "hard_delete";
};

export type AuditLogRetentionPolicyRule = Readonly<AuditLogRetentionKey & AuditLogRetentionPolicy>;

export type AuditLogRetentionKey = {
  action: string;
  entityType: string;
};

/**
 * A concrete creation-time cutoff for one policy partition. The default
 * partition is represented by null action/entity values and excludes every
 * explicit policy key, so unknown entries retain the default policy.
 */
export type AuditLogRetentionCutoff = Readonly<{
  action: string | null;
  entityType: string | null;
  retentionYears: number;
  /** Inclusive lower bound for a bounded calendar exception range. */
  createdAtAfter?: Date;
  createdAtBefore: Date;
  excludedKeys: readonly AuditLogRetentionKey[];
}>;

const DEFAULT_POLICY: AuditLogRetentionPolicy = {
  retentionYears: AUDIT_LOG_DEFAULT_RETENTION_YEARS,
  readAccess: "internal",
  disposal: "hard_delete",
};

export const AUDIT_LOG_RETENTION_POLICIES: readonly AuditLogRetentionPolicyRule[] = [
  {
    action: "household.purge",
    entityType: "household",
    retentionYears: AUDIT_LOG_DEFAULT_RETENTION_YEARS,
    readAccess: "internal",
    disposal: "hard_delete",
  },
];

export function getAuditLogRetentionPolicy(input: AuditLogRetentionKey): AuditLogRetentionPolicy {
  const policy = AUDIT_LOG_RETENTION_POLICIES.find(
    (candidate) => candidate.action === input.action && candidate.entityType === input.entityType,
  );

  if (!policy) return { ...DEFAULT_POLICY };

  return {
    retentionYears: policy.retentionYears,
    readAccess: policy.readAccess,
    disposal: policy.disposal,
  };
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const end = new Date(0);
  end.setUTCFullYear(year, month + 1, 0);
  end.setUTCHours(0, 0, 0, 0);
  return end.getUTCDate();
}

function calendarDateInYear(input: Date, year: number): Date {
  const result = new Date(input);
  const month = input.getUTCMonth();
  result.setUTCFullYear(year, month, Math.min(input.getUTCDate(), daysInMonth(year, month)));
  return result;
}

function startOfUtcDay(input: Date): Date {
  const result = new Date(input);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function endOfUtcDay(input: Date): Date {
  const result = new Date(input);
  result.setUTCHours(23, 59, 59, 999);
  return result;
}

/** Applies calendar-year retention to a timestamp without changing its UTC time. */
export function auditLogRetentionDeadlineForYears(input: {
  createdAt: Date;
  retentionYears: number;
}): Date {
  const deadline = new Date(input.createdAt);
  const month = deadline.getUTCMonth();
  const day = deadline.getUTCDate();

  deadline.setUTCFullYear(deadline.getUTCFullYear() + input.retentionYears);

  // Preserve a calendar-year boundary for February 29 entries when the target
  // year is not a leap year rather than silently moving the deadline into March.
  if (month === 1 && day === 29 && deadline.getUTCMonth() !== month) {
    deadline.setUTCMonth(month + 1, 0);
  }

  return deadline;
}

/**
 * Returns the scalar upper bound for the ordinary portion of one policy
 * partition. Callers must use `getAuditLogRetentionCutoffs`, because a
 * February 28 source leap-day exception is represented by a separate range
 * rather than this private helper's scalar result.
 */
function ordinaryPartitionUpperBound(input: { now: Date; retentionYears: number }): Date {
  const sourceYear = input.now.getUTCFullYear() - input.retentionYears;
  const cutoff = calendarDateInYear(input.now, sourceYear);

  if (
    isLeapYear(input.now.getUTCFullYear()) &&
    !isLeapYear(sourceYear) &&
    input.now.getUTCMonth() === 1 &&
    input.now.getUTCDate() === 29
  ) {
    return endOfUtcDay(cutoff);
  }

  const nextDay = new Date(cutoff);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  if (
    auditLogRetentionDeadlineForYears({
      createdAt: nextDay,
      retentionYears: input.retentionYears,
    }).getTime() <= input.now.getTime()
  ) {
    return nextDay;
  }

  return cutoff;
}

function cutoffsForPolicy(input: {
  action: string | null;
  entityType: string | null;
  retentionYears: number;
  now: Date;
  excludedKeys: readonly AuditLogRetentionKey[];
}): readonly AuditLogRetentionCutoff[] {
  const createdAtBefore = ordinaryPartitionUpperBound({
    now: input.now,
    retentionYears: input.retentionYears,
  });
  const base = {
    action: input.action,
    entityType: input.entityType,
    retentionYears: input.retentionYears,
    excludedKeys: input.excludedKeys,
  };
  const sourceYear = input.now.getUTCFullYear() - input.retentionYears;

  // A leap-day source row can expire on February 28 while a later February 28
  // source row with the same clock time is not expired yet. Keep that small
  // calendar exception as its own concrete range so an index-ordered query
  // cannot repeatedly skip the due leap-day row at a tight pass limit.
  if (
    !isLeapYear(input.now.getUTCFullYear()) &&
    isLeapYear(sourceYear) &&
    input.now.getUTCMonth() === 1 &&
    input.now.getUTCDate() === 28 &&
    createdAtBefore.getUTCMonth() === 1 &&
    createdAtBefore.getUTCDate() === 29 &&
    auditLogRetentionDeadlineForYears({
      createdAt: createdAtBefore,
      retentionYears: input.retentionYears,
    }).getTime() <= input.now.getTime()
  ) {
    const regularCutoff = new Date(createdAtBefore);
    regularCutoff.setUTCDate(regularCutoff.getUTCDate() - 1);
    return [
      { ...base, createdAtBefore: regularCutoff },
      {
        ...base,
        createdAtAfter: startOfUtcDay(createdAtBefore),
        createdAtBefore,
      },
    ];
  }

  return [{ ...base, createdAtBefore }];
}

export function getAuditLogRetentionCutoffs(input: {
  now: Date;
  policies?: readonly AuditLogRetentionPolicyRule[];
  defaultRetentionYears?: number;
}): readonly AuditLogRetentionCutoff[] {
  const policies = input.policies ?? AUDIT_LOG_RETENTION_POLICIES;
  const defaultRetentionYears = input.defaultRetentionYears ?? AUDIT_LOG_DEFAULT_RETENTION_YEARS;

  return [
    ...policies.flatMap((policy) =>
      cutoffsForPolicy({
        action: policy.action,
        entityType: policy.entityType,
        retentionYears: policy.retentionYears,
        now: input.now,
        excludedKeys: [],
      }),
    ),
    ...cutoffsForPolicy({
      action: null,
      entityType: null,
      retentionYears: defaultRetentionYears,
      now: input.now,
      excludedKeys: policies.map(({ action, entityType }) => ({ action, entityType })),
    }),
  ];
}

export function auditLogRetentionDeadline(input: AuditLogRetentionKey & { createdAt: Date }): Date {
  const policy = getAuditLogRetentionPolicy(input);
  return auditLogRetentionDeadlineForYears({
    createdAt: input.createdAt,
    retentionYears: policy.retentionYears,
  });
}

export function isAuditLogEntryExpired(
  input: AuditLogRetentionKey & { createdAt: Date; now: Date },
): boolean {
  return auditLogRetentionDeadline(input).getTime() <= input.now.getTime();
}
