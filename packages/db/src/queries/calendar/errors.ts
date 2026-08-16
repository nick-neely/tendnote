export type CalendarAuthorizationFailureKind = "token" | "provider";

/** A provider read failed because the owner's authorization is no longer usable. */
export class CalendarAuthorizationError extends Error {
  readonly kind: CalendarAuthorizationFailureKind;
  readonly status: number | undefined;

  constructor(
    kind: CalendarAuthorizationFailureKind,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super("Google Calendar authorization failed.", options);
    this.name = "CalendarAuthorizationError";
    this.kind = kind;
    this.status = options.status;
  }
}

export function isCalendarAuthorizationError(error: unknown): error is CalendarAuthorizationError {
  return error instanceof CalendarAuthorizationError;
}
