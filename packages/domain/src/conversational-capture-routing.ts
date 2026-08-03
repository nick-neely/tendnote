import type { AssetKind } from "./assets";
import { formatLocalDate, zonedWallTimeToUtc } from "./brief-schedules";
import {
  type ContextFactCategory,
  type ContextFactSensitivity,
  isSensitiveContextFactContent,
} from "./context-facts";
import { type GeneralActionRecurrence, MAX_RECURRENCE_INTERVAL } from "./general-actions";
import type { ReminderScheduleChoice } from "./reminders";
import type { SavedItemKind } from "./saved-items";

type SavedItemCaptureRoute =
  | { destination: "saved_item"; explicit?: never; kind?: never; text?: never; bringBackAt?: never }
  | {
      destination: "saved_item";
      explicit: true;
      kind: SavedItemKind;
      text: string;
      bringBackAt: Date | null;
    };

export type ConversationalCaptureSingleRoute =
  | SavedItemCaptureRoute
  | {
      destination: "context_fact";
      category: Exclude<ContextFactCategory, "composition">;
      content: string;
      sensitivity: ContextFactSensitivity;
    }
  | { destination: "person"; displayName: string }
  | {
      destination: "memory";
      personQuery: string;
      content: string;
    }
  | {
      destination: "asset_review";
      assetName: string;
      assetKind: AssetKind;
      fact: string | null;
    }
  | {
      destination: "action";
      title: string;
      dueAt: Date | null;
      recurrence: GeneralActionRecurrence | null;
      reminderSchedule?: ReminderScheduleChoice;
    }
  | {
      destination: "followup";
      personQuery: string;
      reason: string;
      dueAt: Date;
    }
  | {
      destination: "clarification";
      field: "timing" | "cadence" | "person";
      question: string;
    };

export type ConversationalCaptureRoute =
  | ConversationalCaptureSingleRoute
  | {
      destination: "group";
      outcomes: Exclude<ConversationalCaptureSingleRoute, { destination: "clarification" }>[];
    };

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

function localDateParts(timeZone: string, now: Date) {
  const [year, month, day] = formatLocalDate(timeZone, now).split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("Could not resolve the owner's local date.");
  }
  return { year, month, day };
}

function localNineAm(input: { timeZone: string; year: number; month: number; day: number }) {
  return zonedWallTimeToUtc({ ...input, minute: 9 * 60 });
}

function addLocalDays(input: { timeZone: string; now: Date; days: number }) {
  const origin = localDateParts(input.timeZone, input.now);
  const date = new Date(Date.UTC(origin.year, origin.month - 1, origin.day + input.days));
  return localNineAm({
    timeZone: input.timeZone,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function resolveTiming(originalText: string, timeZone: string, now: Date) {
  if (/\btomorrow\b/i.test(originalText)) {
    return { dueAt: addLocalDays({ timeZone, now, days: 1 }), matched: "tomorrow" };
  }

  const weekdayMatch = originalText.match(
    new RegExp(`\\b(?:on\\s+)?(${WEEKDAYS.join("|")})\\b`, "i"),
  );
  if (weekdayMatch?.[1]) {
    const target = WEEKDAYS.indexOf(weekdayMatch[1].toLowerCase() as (typeof WEEKDAYS)[number]);
    const origin = localDateParts(timeZone, now);
    const current = new Date(Date.UTC(origin.year, origin.month - 1, origin.day)).getUTCDay();
    const days = (target - current + 7) % 7 || 7;
    return { dueAt: addLocalDays({ timeZone, now, days }), matched: weekdayMatch[0] };
  }

  const monthDayMatch = originalText.match(
    new RegExp(`\\bon\\s+(${MONTHS.join("|")})\\s+(\\d{1,2})\\b`, "i"),
  );
  if (monthDayMatch?.[1] && monthDayMatch[2]) {
    const month = MONTHS.indexOf(monthDayMatch[1].toLowerCase() as (typeof MONTHS)[number]) + 1;
    const day = Number(monthDayMatch[2]);
    const origin = localDateParts(timeZone, now);
    let year = origin.year;
    if (month < origin.month || (month === origin.month && day <= origin.day)) year += 1;
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCMonth() + 1 !== month || candidate.getUTCDate() !== day) {
      return { dueAt: null, matched: monthDayMatch[0], invalid: true };
    }
    return {
      dueAt: localNineAm({ timeZone, year, month, day }),
      matched: monthDayMatch[0],
    };
  }

  return { dueAt: null, matched: null, invalid: false };
}

function resolveRecurrence(originalText: string) {
  const numbered = originalText.match(/\bevery\s+(\d+)\s+(days?|weeks?|months?|years?)\b/i);
  const named = originalText.match(/\b(daily|weekly|monthly|yearly)\b/i);
  if (numbered?.[1] && numbered[2]) {
    const interval = Number(numbered[1]);
    if (!Number.isSafeInteger(interval) || interval < 1 || interval > MAX_RECURRENCE_INTERVAL) {
      return { recurrence: null, matched: numbered[0], invalid: true };
    }
    return {
      recurrence: {
        interval,
        unit: numbered[2].toLowerCase().replace(/s$/, "") as GeneralActionRecurrence["unit"],
      },
      matched: numbered[0],
      invalid: false,
    };
  }
  if (named?.[1]) {
    const unit = named[1].toLowerCase().replace(/ily$/, "y").replace(/ly$/, "");
    return {
      recurrence: { interval: 1, unit: unit as GeneralActionRecurrence["unit"] },
      matched: named[0],
      invalid: false,
    };
  }
  return { recurrence: null, matched: null, invalid: false };
}

function cleanActionTitle(text: string, removals: Array<string | null>) {
  let title = text.replace(
    /^\s*(?:i\s+need\s+to|i\s+have\s+to|remember\s+to|remind\s+me\s+to|todo:?)\s+/i,
    "",
  );
  for (const removal of removals) {
    if (removal)
      title = title.replace(
        new RegExp(`\\s*${removal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"),
        " ",
      );
  }
  title = title.trim().replace(/[.,]$/, "");
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : "";
}

/**
 * Deterministic Capture policy. It recognizes only bounded, explicit wording;
 * everything else remains a Saved Item or asks one consequential clarification.
 * Person lookup stays outside this pure policy and must be owner-scoped.
 */
function routeSingleExplicitCapture(input: {
  originalText: string;
  timeZone: string;
  now: Date;
  allowSelfContext?: boolean;
}): ConversationalCaptureSingleRoute {
  const person = routeExplicitPerson(input.originalText);
  if (person) return person;
  const contextFact = routeExplicitContextFact(input.originalText, input.allowSelfContext);
  if (contextFact) return contextFact;
  const savedItem = routeExplicitSavedItem(input);
  if (savedItem) return savedItem;
  const memory = routeExplicitMemory(input.originalText);
  if (memory) return memory;
  const asset = routeExplicitAsset(input.originalText);
  if (asset) return asset;
  return routeExplicitAction(input);
}

function routeExplicitContextFact(
  originalText: string,
  allowSelfContext: boolean | undefined,
): Extract<ConversationalCaptureSingleRoute, { destination: "context_fact" }> | null {
  const parsed = parseContextFactCapture(originalText, allowSelfContext);
  if (!parsed || isBetterSupportedDestination(parsed.content)) return null;
  const category = categorizeSelfContextFact(parsed.content, parsed.explicit);
  if (!category) return null;
  return {
    destination: "context_fact",
    category,
    content: parsed.content,
    sensitivity: parsed.sensitivity,
  };
}

function parseContextFactCapture(
  originalText: string,
  allowSelfContext: boolean | undefined,
): { content: string; explicit: boolean; sensitivity: ContextFactSensitivity } | null {
  if (allowSelfContext === false) return null;
  const matched = matchContextFactCaptureText(originalText, allowSelfContext);
  if (!matched || (!matched.explicit && !allowSelfContext)) return null;

  const interpreted = interpretContextFactContent(matched.content);
  if (!interpreted || !isSelfContextWording(interpreted.content)) return null;
  if (isSensitiveContextFactContent(interpreted.content)) return null;
  return { ...interpreted, explicit: matched.explicit };
}

function matchContextFactCaptureText(
  originalText: string,
  allowSelfContext: boolean | undefined,
): { content: string; explicit: boolean } | null {
  const explicitMatch = originalText.match(
    /^\s*(?:remember|save|note|keep\s+track\s+of)\s+(?:(?:that|this)\s+)?(?:(?:about\s+me)\s*:\s*)?(.+?)\s*[.!]?\s*$/i,
  );
  const aboutMeMatch = originalText.match(
    /^\s*save\s+(?:this|that)\s+about\s+me\s*(?::|-)\s*(.+?)\s*[.!]?\s*$/i,
  );
  const match =
    aboutMeMatch?.[1] ?? explicitMatch?.[1] ?? (allowSelfContext ? originalText : undefined);
  if (!match) return null;
  return { content: match, explicit: Boolean(explicitMatch || aboutMeMatch) };
}

function interpretContextFactContent(
  matchedContent: string,
): { content: string; sensitivity: ContextFactSensitivity } | null {
  let content = matchedContent.trim().replace(/[.]$/, "");
  if (/^(?:to|me\s+to)\b/i.test(content) || /^i\s+(?:need|have)\s+to\b/i.test(content)) {
    return null;
  }

  let sensitivity: ContextFactSensitivity = "normal";
  const sensitivityMatch = content.match(/^(?:as\s+)?(normal|sensitive|restricted)\s*:\s*(.+)$/i);
  if (sensitivityMatch?.[1] && sensitivityMatch[2]) {
    sensitivity = sensitivityMatch[1].toLowerCase() as ContextFactSensitivity;
    content = sensitivityMatch[2].trim().replace(/[.]$/, "");
  }
  return { content, sensitivity };
}

function isSelfContextWording(content: string) {
  return /^(?:i\b|i['’]m\b|i\s+am\b|my\b)/i.test(content);
}

function categorizeSelfContextFact(
  content: string,
  explicit: boolean,
): Exclude<ContextFactCategory, "composition"> | null {
  const lower = content.toLocaleLowerCase();
  if (
    /^(?:i\s+(?:live|am\s+based|['’]?m\s+based|am\s+from)|my\s+(?:home|location)\b)/i.test(content)
  ) {
    return "location";
  } else if (
    /^(?:i\s+(?:run|work|own|manage|lead|founded)\b|i\s+am\s+(?:an?\s+)?[^.]+\b(?:consultant|developer|designer|engineer|teacher|manager|founder|business\b)|my\s+(?:work|job|career|profession|business|company|role)\b)/i.test(
      content,
    )
  ) {
    return "work";
  } else if (
    /^(?:i\s+(?:like|love|enjoy|collect)\b|i\s+(?:am|['’]?m)\s+interested\s+in\b|my\s+interests?\b)/i.test(
      content,
    )
  ) {
    return "interest";
  } else if (
    /^(?:i\s+(?:prefer|usually)\b|i\s+don['’]?t\s+like\b|my\s+preferences?\b)/i.test(content)
  ) {
    return "preference";
  } else if (/^(?:i\s+(?:avoid|can['’]?t|cannot|require)\b|my\s+constraints?\b)/i.test(content)) {
    return "constraint";
  } else if (
    /^(?:my\s+background\b|i\s+(?:grew\s+up|studied|was\s+born)\b|i\s+have\s+.+\bexperience\b)/i.test(
      content,
    )
  ) {
    return "background";
  }
  return explicit && lower.startsWith("i ") ? "other" : null;
}

function isBetterSupportedDestination(content: string) {
  return [
    /^(?:my|the)\s+(?:(?:next|upcoming|work|home|personal|preferred|usual|kitchen)\s+)*(?:plan|plans|note|notes|link|links|open\s+questions?)\b/i,
    /^i\s+(?:have|made|wrote|saved)\s+(?:an?\s+)?(?:plan|note|link|open\s+question)\b/i,
    /^(?:my|the)\s+(?:(?:next|upcoming|work|home|personal|preferred|usual)\s+)*(?:calendar|schedule|meeting|event|appointment)\b/i,
    /^i\s+(?:have|am\s+attending|attended)\s+(?:an?\s+)?(?:meeting|event|appointment)\b/i,
    /^(?:my|the)\s+(?:(?:preferred|usual|work|home|personal)\s+)*(?:time\s*zone|timezone|locale|language|date\s+format|week\s+start|measurement\s+units)\b/i,
    /^i\s+(?:use|set)\s+(?:an?\s+)?(?:time\s*zone|timezone|locale|language|date\s+format)\b/i,
    /^(?:my|the)\s+(?:(?:new|old|kitchen|home|work)\s+)*(?:car|vehicle|refrigerator|dishwasher|washer|dryer|filter|subscription|service)\b/i,
    /^i\s+(?:own|bought|drive)\s+(?:an?\s+)?(?:car|vehicle|refrigerator|dishwasher|washer|dryer|filter|subscription|service)\b/i,
    /^(?:my|the)\s+(?:relationship|friendship|friend|contact|follow[- ]?up|task|todo|to-do|reminder)\b/i,
    /^i\s+(?:should|must|want\s+to|plan\s+to|intend\s+to|am\s+going\s+to|will)\b/i,
  ].some((pattern) => pattern.test(content));
}

function routeExplicitSavedItem(input: {
  originalText: string;
  timeZone: string;
  now: Date;
}): ConversationalCaptureSingleRoute | null {
  const match = input.originalText.match(
    /^\s*save\s+(?:an?\s+)?(open\s+question|note|link)\s*(?::|about)?\s*(.+?)\s*$/i,
  );
  if (!match?.[1] || !match[2]) return null;
  const bringBackClause =
    match[2].match(/\s*[.]?\s*(?:and\s+)?bring\s+(?:it|this)\s+back\b.*$/i)?.[0] ?? null;
  const timing = bringBackClause
    ? resolveTiming(bringBackClause, input.timeZone, input.now)
    : { dueAt: null, matched: null };
  if (bringBackClause && !timing.dueAt) {
    return {
      destination: "clarification",
      field: "timing",
      question: "When should I bring this Saved Item back?",
    };
  }
  const text = bringBackClause
    ? match[2].slice(0, -bringBackClause.length).trim()
    : match[2].trim();
  const kind = match[1].toLowerCase().replaceAll(" ", "_") as SavedItemKind;
  return {
    destination: "saved_item",
    explicit: true,
    kind,
    text,
    bringBackAt: timing.dueAt,
  };
}

function routeExplicitPerson(originalText: string): ConversationalCaptureSingleRoute | null {
  const match = originalText.match(/^\s*add(?:\s+person)?\s+([^;,.!?]+)\s*[.!]?\s*$/i);
  if (!match?.[1]) return null;
  return { destination: "person", displayName: match[1].trim() };
}

function routeExplicitMemory(originalText: string): ConversationalCaptureSingleRoute | null {
  const match = originalText.match(
    /^\s*(?:remember|save|note|keep\s+track\s+of)(?:\s+that|\s*:)?\s+(.+?)\s*$/i,
  );
  if (!match?.[1] || /^to\b/i.test(match[1])) return null;
  const content = match[1].trim().replace(/[.]$/, "");
  if (/^(?:i\b|i['’]m\b|i\s+am\b|my\b)/i.test(content)) return null;
  const subject = content.match(/^([A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)?)(?=\s)/u)?.[1];
  if (!subject) return null;
  return { destination: "memory", personQuery: subject, content };
}

function routeExplicitAsset(originalText: string): ConversationalCaptureSingleRoute | null {
  const match = originalText.match(/^\s*track\s+asset\s+(.+?)(?:\s*:\s*(.+))?\s*$/i);
  if (!match?.[1]) return null;
  return {
    destination: "asset_review",
    assetName: match[1].trim(),
    assetKind: "item",
    fact: match[2]?.trim() || null,
  };
}

function routeExplicitAction(input: {
  originalText: string;
  timeZone: string;
  now: Date;
}): ConversationalCaptureSingleRoute {
  const { originalText, timeZone, now } = input;
  const actionIntent =
    /^\s*(?:i\s+need\s+to|i\s+have\s+to|remember\s+to|remind\s+me\s+to|todo:?)/i.test(originalText);
  if (!actionIntent) return { destination: "saved_item" };

  const timing = resolveTiming(originalText, timeZone, now);
  const recurrence = resolveRecurrence(originalText);
  const reminder = resolveExplicitReminderSchedule(originalText);
  const vagueTiming = originalText.match(/\b(?:sometime|soon|later|eventually)\b/i)?.[0] ?? null;
  const title = cleanActionTitle(originalText, [
    timing.matched,
    recurrence.matched,
    vagueTiming,
    reminder.matched,
  ]);
  const clarification = actionClarification({
    originalText,
    title,
    timing,
    recurrence,
    vagueTiming,
  });
  if (clarification) return clarification;
  const followup = routeExplicitFollowup(originalText, timing.dueAt);
  if (followup) return followup;
  if (needsMissingTimingClarification(originalText, timing.dueAt, recurrence.recurrence)) {
    return timingClarification(title);
  }
  return {
    destination: "action",
    dueAt: timing.dueAt,
    recurrence: recurrence.recurrence,
    title,
    ...(reminder.schedule ? { reminderSchedule: reminder.schedule } : {}),
  };
}

function resolveExplicitReminderSchedule(originalText: string): {
  matched: string | null;
  schedule: ReminderScheduleChoice | null;
} {
  const lead = originalText.match(
    /\b(?:with\s+)?(?:an?\s+)?alert(?:\s+me)?\s+(one\s+week|one\s+day|one\s+hour)\s+before\b/i,
  );
  if (!lead?.[0] || !lead[1]) return { matched: null, schedule: null };
  const leadMinutes =
    lead[1].toLowerCase() === "one week"
      ? 10_080
      : lead[1].toLowerCase() === "one day"
        ? 1_440
        : 60;
  return {
    matched: lead[0],
    schedule: { kind: "relative", leadMinutes },
  };
}

function actionClarification(input: {
  originalText: string;
  title: string;
  timing: ReturnType<typeof resolveTiming>;
  recurrence: ReturnType<typeof resolveRecurrence>;
  vagueTiming: string | null;
}): ConversationalCaptureSingleRoute | null {
  if (input.timing.invalid || input.vagueTiming) return timingClarification(input.title);
  const vagueCadence = /\b(?:regularly|periodically|often)\b/i.test(input.originalText);
  if ((vagueCadence && !input.recurrence.recurrence) || input.recurrence.invalid) {
    return cadenceClarification(input.title);
  }
  return null;
}

function timingClarification(title: string): ConversationalCaptureSingleRoute {
  return {
    destination: "clarification",
    field: "timing",
    question: `When should I remind you to ${lowercaseFirst(title)}?`,
  };
}

function cadenceClarification(title: string): ConversationalCaptureSingleRoute {
  return {
    destination: "clarification",
    field: "cadence",
    question: `How often should ${lowercaseFirst(title)} repeat?`,
  };
}

function routeExplicitFollowup(
  originalText: string,
  dueAt: Date | null,
): ConversationalCaptureSingleRoute | null {
  const match = originalText.match(
    /\bfollow\s+up\s+with\s+(.+?)(?=\s+(?:tomorrow|on\s+|every\s+|daily\b|weekly\b|monthly\b|yearly\b)|[.,]|$)/i,
  );
  if (!match?.[1]) return null;
  const personQuery = match[1].trim();
  if (!dueAt) {
    return {
      destination: "clarification",
      field: "timing",
      question: `When should I remind you to follow up with ${personQuery}?`,
    };
  }
  return { destination: "followup", dueAt, personQuery, reason: "Follow up" };
}

function needsMissingTimingClarification(
  originalText: string,
  dueAt: Date | null,
  recurrence: GeneralActionRecurrence | null,
) {
  return /^\s*(?:remember\s+to|remind\s+me\s+to)\b/i.test(originalText) && !dueAt && !recurrence;
}

function lowercaseFirst(value: string) {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

export function routeExplicitConversationalCapture(input: {
  originalText: string;
  timeZone: string;
  now: Date;
  allowSelfContext?: boolean;
}): ConversationalCaptureRoute {
  const clauses = input.originalText
    .split(/\s*;\s*(?:and\s+also\s+)?/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length > 1) {
    const outcomes = clauses.map((originalText) =>
      routeSingleExplicitCapture({ ...input, originalText }),
    );
    if (
      outcomes.every(
        (outcome) =>
          outcome.destination !== "clarification" &&
          (outcome.destination !== "saved_item" || outcome.explicit === true),
      )
    ) {
      return {
        destination: "group",
        outcomes: outcomes as Exclude<
          ConversationalCaptureSingleRoute,
          { destination: "clarification" }
        >[],
      };
    }
    return { destination: "saved_item" };
  }
  return routeSingleExplicitCapture(input);
}
