/** Sentence-case a single token, e.g. `networking` -> `Networking`. */
export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Humanize a snake_case enum, e.g. `life_event` -> `Life event`. */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Friendly month + day for a stored birthday (`YYYY-MM-DD` or `MM-DD`). The year
 * is dropped; an anniversary doesn't need it and showing 1990 reads like a record,
 * not a person. Returns the raw value if it can't be parsed.
 */
export function formatBirthday(birthday: string): string {
  const parts = birthday.split("-").map((part) => Number.parseInt(part, 10));
  const [month, day] = parts.length === 3 ? [parts[1], parts[2]] : parts;

  if (!month || !day || Number.isNaN(month) || Number.isNaN(day)) {
    return birthday;
  }

  return new Date(2000, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
