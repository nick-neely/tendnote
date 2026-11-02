/** A failed occurrence keeps its date and attempt budget while its lease holds retries. */
export function scheduledWorkflowRetryHold(now: Date, delayMs?: number): { retryAt?: Date } {
  return delayMs ? { retryAt: new Date(now.getTime() + delayMs) } : {};
}
