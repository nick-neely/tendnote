import type { RelationshipAgendaCandidateView } from "@/lib/eve/tool-result-view";

type AgendaKind = RelationshipAgendaCandidateView["kind"];
type AgendaTrust = RelationshipAgendaCandidateView["trustLevel"];
type Sensitivity = RelationshipAgendaCandidateView["sensitivity"];
type SourceRefs = RelationshipAgendaCandidateView["sourceRefs"];

/**
 * The three trust tones the agenda calendar encodes with color (DESIGN.md §3):
 * sage for context that's grounded in a person or an active reminder, clay for
 * tentative items the user still has to review, and a neutral tone for context
 * that's merely logged. Color says how much to trust an item before a word is
 * read; the kind icon and the always-present text labels carry the rest, so the
 * encoding never leans on color alone.
 */
export type AgendaTone = "grounded" | "review" | "logged";

export function agendaTone(kind: AgendaKind): AgendaTone {
  switch (kind) {
    case "birthday":
    case "due_followup":
      return "grounded";
    case "suggested_followup":
    case "review_item":
      return "review";
    case "recent_context":
    case "semantic_context":
      return "logged";
  }
}

/**
 * Per-tone presentation. `marker` is the small shape painted in a calendar cell
 * (a distinct silhouette per tone so the three read apart without color), and
 * `swatch` is the legend chip that names what the color means.
 */
export const AGENDA_TONE_META: Record<
  AgendaTone,
  { label: string; marker: "disc" | "diamond" | "ring"; dot: string; text: string; soft: string }
> = {
  grounded: {
    label: "Grounded",
    marker: "disc",
    dot: "bg-primary",
    text: "text-primary",
    soft: "bg-primary/10",
  },
  review: {
    label: "To review",
    marker: "diamond",
    dot: "bg-accent",
    text: "text-accent",
    soft: "bg-accent-soft/45",
  },
  logged: {
    label: "Logged",
    marker: "ring",
    dot: "border border-muted-foreground/70",
    text: "text-muted-foreground",
    soft: "bg-secondary/60",
  },
};

/** Tones present in a set of candidates, in legend order, deduped. */
export function distinctTones(candidates: RelationshipAgendaCandidateView[]): AgendaTone[] {
  const order: AgendaTone[] = ["grounded", "review", "logged"];
  const present = new Set(candidates.map((candidate) => agendaTone(candidate.kind)));
  return order.filter((tone) => present.has(tone));
}

export function labelAgendaKind(kind: AgendaKind): string {
  switch (kind) {
    case "due_followup":
      return "Follow-up";
    case "birthday":
      return "Birthday";
    case "review_item":
      return "Review";
    case "recent_context":
      return "Recent context";
    case "semantic_context":
      return "Semantic context";
    case "suggested_followup":
      return "Suggested follow-up";
  }
}

export function labelAgendaTrust(trustLevel: AgendaTrust): string {
  switch (trustLevel) {
    case "active_reminder":
      return "Active reminder";
    case "stored_profile_data":
      return "Stored profile data";
    case "logged_context":
      return "Logged context";
    case "confirmed_fact":
      return "Confirmed fact";
    case "tentative":
      return "Tentative";
  }
}

export function labelAgendaDue(kind: AgendaKind, dueLabel: string): string {
  if (kind === "birthday") {
    return `Upcoming ${dueLabel}`;
  }
  if (kind === "suggested_followup") {
    return `Suggested for ${dueLabel}`;
  }
  if (kind === "recent_context") {
    return `Logged ${dueLabel}`;
  }
  return `Due ${dueLabel}`;
}

export function labelSensitivity(sensitivity: Sensitivity): string {
  if (sensitivity === "restricted") return "Restricted";
  return sensitivity === "sensitive" ? "Sensitive" : "Normal";
}

export function labelSourceGrounding(sourceRefs: SourceRefs): string | null {
  const kinds = new Set(sourceRefs.map((sourceRef) => sourceRef.kind));
  const labels: string[] = [];
  if (kinds.has("followup")) labels.push("follow-up");
  if (kinds.has("person")) labels.push("person");
  if (kinds.has("memory")) labels.push("memory");
  if (kinds.has("source_record")) labels.push("source record");

  if (labels.length === 0) {
    return null;
  }

  return `Grounded in ${labels.join(" + ")}`;
}

/**
 * Dates from the agenda read model are instants, but each one stands for a single
 * calendar day (a birthday is constructed at UTC midnight; a follow-up's day is
 * what matters, not its time). We bucket and render every date in UTC so the day
 * a marker lands on never drifts with the viewer's timezone, and so a persisted
 * chat message renders the same calendar wherever it's opened.
 */
export function agendaDayKey(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return dayKeyFromDate(date);
}

export function dayKeyFromDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatAgendaDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatAgendaWeekday(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** UTC-midnight Date for an ISO instant, used to anchor and bound the calendar. */
export function utcDayDate(iso: string): Date | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Compact "Jun 27 – Jul 4, 2026" label for the requested agenda window. */
export function formatAgendaRange(startIso: string, endIso: string): string | null {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  const monthDay = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const year = end.toLocaleDateString("en-US", { year: "numeric", timeZone: "UTC" });

  if (sameMonth) {
    const endDay = end.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
    return `${monthDay(start)} – ${endDay}, ${year}`;
  }
  if (sameYear) {
    return `${monthDay(start)} – ${monthDay(end)}, ${year}`;
  }
  return `${formatAgendaDay(startIso)} – ${formatAgendaDay(endIso)}`;
}
