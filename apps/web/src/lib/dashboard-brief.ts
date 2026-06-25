import type { Person } from "@tendnote/domain";

export type UpcomingBirthday = {
  person: Person;
  daysUntil: number;
  label: string;
};

/**
 * Days until a person's next birthday occurrence, or null when the stored value
 * can't be parsed. Accepts `YYYY-MM-DD` or `MM-DD`; the year, when present, is
 * ignored so the count always tracks the next anniversary.
 */
function daysUntilNextBirthday(birthday: string, today: Date): number | null {
  const parts = birthday.split("-").map((part) => Number.parseInt(part, 10));
  const [month, day] = parts.length === 3 ? [parts[1], parts[2]] : parts;

  if (!month || !day || Number.isNaN(month) || Number.isNaN(day)) {
    return null;
  }

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(startOfToday.getFullYear(), month - 1, day);

  if (next.getTime() < startOfToday.getTime()) {
    next = new Date(startOfToday.getFullYear() + 1, month - 1, day);
  }

  return Math.round((next.getTime() - startOfToday.getTime()) / 86_400_000);
}

function birthdayLabel(daysUntil: number): string {
  if (daysUntil === 0) {
    return "Today";
  }

  if (daysUntil === 1) {
    return "Tomorrow";
  }

  return `In ${daysUntil} days`;
}

/**
 * Gentle daily-brief signal: people whose birthday lands within the window,
 * soonest first. Grounded entirely in saved people records — no invented data.
 */
export function getUpcomingBirthdays(
  people: Person[],
  options: { withinDays?: number; today?: Date } = {},
): UpcomingBirthday[] {
  const withinDays = options.withinDays ?? 21;
  const today = options.today ?? new Date();

  return people
    .flatMap((person) => {
      if (!person.birthday) {
        return [];
      }

      const daysUntil = daysUntilNextBirthday(person.birthday, today);

      if (daysUntil === null || daysUntil > withinDays) {
        return [];
      }

      return [{ person, daysUntil, label: birthdayLabel(daysUntil) }];
    })
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

export function shortName(person: Person): string {
  return person.firstName?.trim() || person.displayName.split(" ")[0] || person.displayName;
}

export function initials(displayName: string): string {
  const tokens = displayName.trim().split(/\s+/).slice(0, 2);
  return tokens.map((token) => token[0]?.toUpperCase() ?? "").join("") || "·";
}
