import type { PrivacyScope } from "./privacy";

/**
 * The eight domains a Household Guest reads, in the order the library shows
 * them (ADR 0245, the Household Guest experience). Every one is always present,
 * so a domain with nothing readable shows zero rather than disappearing.
 */
export const GUEST_LIBRARY_DOMAINS = [
  "people",
  "memories",
  "followUps",
  "generalActions",
  "assets",
  "giftPlans",
  "householdContext",
  "calendarEvents",
] as const;

export type GuestLibraryDomain = (typeof GUEST_LIBRARY_DOMAINS)[number];

/**
 * Why the guest can see a record. These three are the whole read set: anything
 * else, a member's private record above all, is not in the library at all.
 */
export type GuestRecordReason = "household_native" | "household_scope" | "shared_scope";

/** One record as the guest library shows it: content plus its provenance. */
export type GuestLibraryRecord = {
  id: string;
  title: string;
  /** One short line of context under the title, such as who a memory is about. */
  context: string | null;
  /** Longer content the detail pane shows, when the record has any beyond its title. */
  body: string | null;
  /** The member it belongs to, or `null` when it is the household's own. */
  belongsTo: string | null;
  reason: GuestRecordReason;
  date: Date | null;
};

export type GuestLibraryShelf = {
  domain: GuestLibraryDomain;
  /**
   * Everything the guest may read here, and nothing else. A shelf's count is
   * this list's length, so a withheld record can be neither shown nor counted.
   */
  records: GuestLibraryRecord[];
  /** The read failed, so the shelf cannot honestly claim to be empty. */
  unavailable: boolean;
};

export type GuestLibrary = {
  householdName: string;
  shelves: GuestLibraryShelf[];
};

/**
 * A record a domain loader offers, before the library decides whether a guest
 * may have it. Loaders read through their domain's own authorized reads; these
 * facts are the second, guest-specific gate on top.
 */
export type GuestLibraryCandidate = Omit<GuestLibraryRecord, "reason"> & {
  scope: PrivacyScope;
  householdNative: boolean;
  /** The guest's own record is not one shared with them. */
  viewerIsOwner: boolean;
};

/**
 * The guest gate: household-native records, household-scope records, and
 * shared-scope records addressed to the guest. A private record, or a record
 * the guest owns, has no reason to be here and is dropped.
 */
export function guestRecordReason(candidate: GuestLibraryCandidate): GuestRecordReason | null {
  if (candidate.householdNative) return "household_native";
  if (candidate.viewerIsOwner) return null;
  if (candidate.scope === "household") return "household_scope";
  if (candidate.scope === "shared") return "shared_scope";
  return null;
}

/** Keeps only what the guest may read, with the reason it may. */
export function toGuestLibraryRecords(
  candidates: readonly GuestLibraryCandidate[],
): GuestLibraryRecord[] {
  const records: GuestLibraryRecord[] = [];
  for (const candidate of candidates) {
    const reason = guestRecordReason(candidate);
    if (!reason) continue;
    const { scope: _scope, householdNative: _native, viewerIsOwner: _owner, ...record } = candidate;
    records.push({ ...record, reason });
  }
  return records;
}
