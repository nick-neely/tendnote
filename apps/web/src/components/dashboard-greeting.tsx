function greetingFor(hour: number): string {
  if (hour < 5) {
    return "Good evening";
  }

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

/**
 * Calm, time-aware header for the dashboard. The page is `force-dynamic`, so this
 * renders per request against the server clock — for a local-first personal app
 * the server is the user's machine, which keeps it correct without a hydration
 * dance over the current time.
 */
export function DashboardGreeting({ now = new Date() }: { now?: Date }) {
  const greeting = greetingFor(now.getHours());
  const dateLabel = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <header className="flex flex-col gap-1">
      <h1 className="font-display text-[length:var(--text-display)] leading-[var(--text-display-line)] font-semibold tracking-normal">
        {greeting}.
      </h1>
      <p className="text-sm text-muted-foreground">{dateLabel}</p>
    </header>
  );
}
