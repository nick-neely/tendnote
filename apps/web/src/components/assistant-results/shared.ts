/**
 * Formats an ISO instant as a plain "Jul 15, 2026" day label. Shared by the
 * follow-up, draft, and General Action projections so a persisted due date reads
 * the same wherever it surfaces. A malformed value falls back to its raw string
 * rather than an "Invalid Date", so a bad payload never renders a broken label.
 */
export function formatDueLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * True when a tool payload is a recognized well-formed negative — an object whose
 * discriminant flag (`found`/`created`/`updated`) is explicitly `false`. Tools whose
 * success schema pins that flag to `true` reject the negative at `safeParse`; this
 * distinguishes that honest "nothing happened" outcome from a genuinely corrupt
 * payload, which carries no such flag.
 */
export function flagIsFalse(output: unknown, flag: "found" | "created" | "updated"): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as Record<string, unknown>)[flag] === false
  );
}
