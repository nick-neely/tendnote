import type {
  GuestLibrary,
  GuestLibraryDomain,
  GuestLibraryRecord,
  GuestLibraryShelf,
} from "@tendnote/domain/guest-library";
import { GUEST_PATH } from "@/lib/access/access-state";

type ShelfCopy = {
  label: string;
  /** What the shelf holds, said where nothing is selected yet. */
  about: string;
  empty: string;
  /** What a record's date means on this shelf, or `null` where records have none. */
  dateLabel: string | null;
  /** Upcoming things read soonest first; recorded things newest first. */
  order: "soonest" | "newest" | "name";
};

export const GUEST_SHELF_COPY: Record<GuestLibraryDomain, ShelfCopy> = {
  people: {
    label: "People",
    about: "The other members of this household.",
    empty: "Nobody else is in this household yet.",
    dateLabel: null,
    order: "name",
  },
  memories: {
    label: "Memories",
    about: "Memories members have shared with the household, or with you.",
    empty: "No memories are shared with you yet.",
    dateLabel: "Saved",
    order: "newest",
  },
  followUps: {
    label: "Follow-ups",
    about: "Follow-ups members have shared with the household, or with you.",
    empty: "No follow-ups are shared with you yet.",
    dateLabel: "Due",
    order: "soonest",
  },
  generalActions: {
    label: "Actions",
    about: "The household's own actions, and ones members share with it.",
    empty: "No actions are shared with you yet.",
    dateLabel: "Due",
    order: "soonest",
  },
  assets: {
    label: "Assets",
    about: "The household's things, and ones members share with it.",
    empty: "No assets are shared with you yet.",
    dateLabel: "Added",
    order: "name",
  },
  giftPlans: {
    label: "Gift plans",
    about: "Gift plans you are a co-planner on.",
    empty: "You aren't a co-planner on any gift plan yet.",
    dateLabel: "Occasion",
    order: "soonest",
  },
  householdContext: {
    label: "Household context",
    about: "What the household keeps true about itself.",
    empty: "The household hasn't added any context yet.",
    dateLabel: "Added",
    order: "newest",
  },
  calendarEvents: {
    label: "Calendar",
    about: "The next two weeks on the calendars the household shares.",
    empty: "Nothing on the household's calendars in the next two weeks.",
    dateLabel: "Starts",
    order: "soonest",
  },
};

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  // The household surfaces format in UTC, so a date-only value such as a gift
  // plan's occasion reads as the day it was stored as.
  timeZone: "UTC",
});

export function formatGuestDate(date: Date): string {
  return DAY.format(date);
}

function compareRecords(order: ShelfCopy["order"]) {
  return (left: GuestLibraryRecord, right: GuestLibraryRecord) => {
    if (order === "name") return left.title.localeCompare(right.title);
    // Undated records follow the dated ones either way.
    if (!left.date || !right.date) return (left.date ? -1 : 1) - (right.date ? -1 : 1);
    const delta = left.date.getTime() - right.date.getTime();
    return order === "soonest" ? delta : -delta;
  };
}

/** A shelf's records in the order a reader expects for that kind of thing. */
export function orderedRecords(shelf: GuestLibraryShelf): GuestLibraryRecord[] {
  return [...shelf.records].sort(compareRecords(GUEST_SHELF_COPY[shelf.domain].order));
}

/** Whom a record belongs to, in a sentence fragment. */
export function guestOwnerLabel(record: GuestLibraryRecord): string {
  return record.belongsTo ?? "The household";
}

/** Why the guest can see this record, said plainly. */
export function guestReasonCopy(domain: GuestLibraryDomain, record: GuestLibraryRecord): string {
  switch (record.reason) {
    case "household_native":
      if (domain === "people") return "They are a member of this household.";
      if (domain === "calendarEvents") return "It is on a calendar the household shares.";
      return "It belongs to the household, so every member can read it.";
    case "household_scope":
      return `${guestOwnerLabel(record)} shared it with the whole household.`;
    case "shared_scope":
      return `${guestOwnerLabel(record)} shared it with you.`;
  }
}

function isDomain(value: string | undefined): value is GuestLibraryDomain {
  return value !== undefined && Object.hasOwn(GUEST_SHELF_COPY, value);
}

/**
 * The shelf and record a request asks for. An unknown shelf falls back to the
 * first one with something on it, and an unknown record to none: a stale link
 * to a record the guest can no longer read opens the shelf, not an error that
 * would confirm the record ever existed.
 */
export function selectGuestShelf(
  library: GuestLibrary,
  params: { shelf?: string; record?: string },
): { shelf: GuestLibraryShelf; record: GuestLibraryRecord | null } {
  const requested = isDomain(params.shelf)
    ? library.shelves.find((shelf) => shelf.domain === params.shelf)
    : undefined;
  const shelf =
    requested ??
    library.shelves.find((candidate) => candidate.records.length > 0) ??
    (library.shelves[0] as GuestLibraryShelf);
  const record = shelf.records.find((candidate) => candidate.id === params.record) ?? null;
  return { shelf, record };
}

export function guestLibraryHref(domain: GuestLibraryDomain, recordId?: string): string {
  const params = new URLSearchParams({ shelf: domain });
  if (recordId) params.set("record", recordId);
  return `${GUEST_PATH}?${params.toString()}`;
}
