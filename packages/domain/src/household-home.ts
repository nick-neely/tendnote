import { z } from "zod";
import type { HouseholdRecordOwnership } from "./household-authorization";

/**
 * The record families the shared Household row can render.
 *
 * This is wider than the Household home's composition because the same compact
 * row also appears in a member's caller-scoped Household Check-in. Gift Plans
 * belong only to that Check-in: they are private, member-owned planning
 * references with a selected audience and Surprise Subject exclusion, and the
 * Check-in already owns that per-caller view (#396).
 */
export const householdCoordinationFamilySchema = z.enum(["action", "routine", "gift_plan"]);
export type HouseholdCoordinationFamily = z.infer<typeof householdCoordinationFamilySchema>;

/**
 * The record families the shared Household home can compose.
 *
 * Actions and Routines launch the destination because they have a full Phase
 * Eight collaboration contract (#383). Gift Plans are deliberately absent from
 * this surface and remain eligible for the caller-scoped Household Check-in
 * instead (#396). This does not claim two members' authorized home records are
 * always identical — selected-member sharing may legitimately differ. Saved
 * Items, Event Plans, and shared Follow-Ups each owe their own implemented home
 * contract before they may be added here; adding one is a new enum member, a
 * loader, and a destination case.
 */
export const householdHomeFamilySchema = z.enum(["action", "routine"]);
export type HouseholdHomeFamily = z.infer<typeof householdHomeFamilySchema>;

/**
 * The home's two sections, and the only two it has.
 *
 * `needs_attention` is the stable wire key for what the household could act on
 * now; its human heading is **Ready now**, which describes availability without
 * manufacturing urgency or guilt (#398). `coming_up` is what is dated and
 * approaching. There is deliberately no third collection — no activity stream,
 * no member panel, no "recently completed" — because the home answers one
 * question and a third section would start answering another.
 */
export const householdHomeSectionSchema = z.enum(["needs_attention", "coming_up"]);
export type HouseholdHomeSection = z.infer<typeof householdHomeSectionSchema>;

export const householdHomeSectionHeadings: Record<HouseholdHomeSection, string> = {
  needs_attention: "Ready now",
  coming_up: "Coming up",
};

export const householdHomeTimingCodeSchema = z.enum([
  "overdue",
  "due_today",
  "resurfaced",
  "scheduled",
]);
export type HouseholdHomeTimingCode = z.infer<typeof householdHomeTimingCodeSchema>;

export const householdHomeRecordKindSchema = z.enum(["general_action", "gift_plan"]);

/**
 * The one inline mutation the home may offer.
 *
 * Completion is reversible and already authorized for anyone who can see the
 * record, so it is safe to put on a read-first surface. Skipping, deferring,
 * pausing, archiving, and holder changes are not, and they link to the record
 * instead — the home never invents a universal household control.
 *
 * `expectedOccurrenceVersion` travels with the offer so the tap is fenced on the
 * occurrence the member actually saw. A second member acting on the same
 * occurrence is reconciled by the domain, never double-advanced (#383).
 */
export const householdHomeProgressSchema = z.object({
  kind: z.literal("complete_record"),
  label: z.string().min(1),
  expectedOccurrenceVersion: z.number().int().min(0),
});

export const householdHomeRecordSchema = z.object({
  /** Family-prefixed and stable, so two families can never collide on one id. */
  identity: z.string().min(1),
  family: householdCoordinationFamilySchema,
  section: householdHomeSectionSchema,
  /**
   * Whether the record is already asking something of the household today.
   *
   * The flag exists only to decide how much room a section may take: pressing
   * records fill it to the ceiling because hiding an overdue chore behind a link
   * would be dishonest, and everything else stops at the normal three. It is
   * never rendered as a badge, a colour, or a severity.
   */
  pressing: z.boolean(),
  record: z.object({
    kind: householdHomeRecordKindSchema,
    id: z.string().min(1),
    /** The canonical domain surface for this record. Always present. */
    href: z.string().min(1),
  }),
  title: z.string().min(1),
  /** The record's own type and cadence, in words. "Action", "Routine · weekly". */
  context: z.string().min(1),
  timing: z.object({
    code: householdHomeTimingCodeSchema,
    /** Factual and unhurried. Never "overdue", "missed", or "late" (DESIGN.md §9). */
    explanation: z.string().min(1),
  }),
  /** "Household" for a workspace-owned record, "Shared by Mara" for a member's. */
  scopeLabel: z.string().min(1),
  /** "Ana is looking after this", or null — which is the ordinary, calm case. */
  responsibility: z.string().nullable(),
  progress: householdHomeProgressSchema.nullable(),
  /** The instant the timing refers to. The section's sort key. */
  at: z.date(),
  createdAt: z.date(),
});
export type HouseholdHomeRecord = z.infer<typeof householdHomeRecordSchema>;

export type HouseholdHomeDestination = {
  family: HouseholdHomeFamily;
  label: string;
  href: string;
};

export type HouseholdHomeSectionView = {
  section: HouseholdHomeSection;
  heading: string;
  records: HouseholdHomeRecord[];
  /**
   * Where the rest of this section's eligible records live, when the cap left
   * some out.
   *
   * Deliberately a labelled link and no number. A remaining count on a household
   * home is a backlog badge: it reports a quantity of undone work to two people
   * at once, which is exactly the nagging this product refuses (PRODUCT.md
   * anti-references). The link is the honest affordance — it says where the rest
   * is without saying how much of it there is.
   */
  more: { destinations: HouseholdHomeDestination[] } | null;
  /**
   * What the member is told when a domain family could not be read. One failed
   * family never empties a section that other families filled, and never becomes
   * a global failure state.
   */
  limitations: string[];
};

export type HouseholdHomeComposition = {
  needsAttention: HouseholdHomeSectionView;
  comingUp: HouseholdHomeSectionView;
};

/**
 * Three records normally, five at most.
 *
 * The same shape as Today's cap (ADR 0196) and for the same reason: a shortlist
 * that grows without bound stops being a shortlist. The ceiling exists so that a
 * genuinely busy week is not misrepresented as a calm one, not so the section can
 * routinely run longer.
 */
const HOUSEHOLD_HOME_TARGET_RECORDS = 3;
const HOUSEHOLD_HOME_MAX_RECORDS = 5;

/**
 * How far ahead "approaching soon" reaches.
 *
 * Two weeks: long enough that a fortnightly chore and a dated plan are visible
 * before they need doing, short enough that Coming up stays a horizon rather
 * than a calendar. Shared by every family so the home has one idea of soon.
 */
export const HOUSEHOLD_HOME_COMING_UP_DAYS = 14;

/**
 * Who a record on the home belongs to, in one quiet phrase.
 *
 * Two sentences, never both. A household-native record is the household's, and
 * naming its creator would credit a chore the workspace owns to whoever happened
 * to type it — its `ownerUserId` is a storage key, not an author (ADR 0214). A
 * member-owned record shared into the household is theirs, and says so.
 *
 * Attribution, never responsibility: this line says who the record belongs to
 * and nothing about who is expected to do it.
 */
export function householdRecordScopeLabel(input: {
  ownership: HouseholdRecordOwnership;
  ownerName: string | null;
  isSelf: boolean;
}): string {
  if (input.ownership === "household_native") return "Household";
  if (input.isSelf) return "Shared by you";
  return input.ownerName ? `Shared by ${input.ownerName}` : "Shared by a household member";
}

/**
 * The labelled domain surface that holds the rest of a family's records.
 *
 * Actions and Routines share one canonical destination, so a section that
 * overflowed with both offers one link rather than two names for one page.
 */
export function householdHomeFamilyDestination(
  family: HouseholdHomeFamily,
): Omit<HouseholdHomeDestination, "family"> {
  switch (family) {
    case "action":
    case "routine":
      return { label: "Actions", href: "/actions" };
  }
}

/**
 * Composes the two capped sections from every family's eligible records.
 *
 * Deterministic end to end: the same records in any order produce the same two
 * sections, in the same order, for every member who can see them. There is no
 * per-member ranking, no generated priority, and no read of any member's private
 * Today state — a member's **Not today** is stored against their own owner id and
 * is never handed to this function, so it structurally cannot reorder or hide a
 * record for anybody, including the member who chose it.
 */
export function composeHouseholdHome(input: {
  records: readonly HouseholdHomeRecord[];
  limitations?: readonly string[];
}): HouseholdHomeComposition {
  const records = deduplicateRecords(
    input.records.map((record) => householdHomeRecordSchema.parse(record)),
  ).filter(isHouseholdHomeRecord);
  const limitations = [...new Set(input.limitations ?? [])];
  return {
    needsAttention: sectionView("needs_attention", records, limitations),
    comingUp: sectionView("coming_up", records, limitations),
  };
}

function sectionView(
  section: HouseholdHomeSection,
  records: readonly ComposedHouseholdHomeRecord[],
  limitations: readonly string[],
): HouseholdHomeSectionView {
  const ordered = records.filter((record) => record.section === section).sort(compareRecords);
  const pressing = ordered.filter((record) => record.pressing);
  const shown =
    pressing.length >= HOUSEHOLD_HOME_MAX_RECORDS
      ? pressing.slice(0, HOUSEHOLD_HOME_MAX_RECORDS)
      : [
          ...pressing,
          ...ordered
            .filter((record) => !record.pressing)
            .slice(0, Math.max(0, HOUSEHOLD_HOME_TARGET_RECORDS - pressing.length)),
        ];
  const omitted = ordered.filter((record) => !shown.includes(record));
  return {
    section,
    heading: householdHomeSectionHeadings[section],
    // Re-sorted because the cap picks pressing records first, and the section
    // still reads by time rather than by how it was filled.
    records: [...shown].sort(compareRecords),
    more: omitted.length > 0 ? { destinations: destinationsFor(omitted) } : null,
    limitations: [...limitations],
  };
}

/**
 * Earliest first, then by identity.
 *
 * Time is the only ranking the home has. The identity tie-break is what makes
 * two members with the same access see the same order rather than whichever the
 * database happened to return first.
 */
function compareRecords(left: HouseholdHomeRecord, right: HouseholdHomeRecord): number {
  return left.at.getTime() - right.at.getTime() || left.identity.localeCompare(right.identity);
}

function deduplicateRecords(records: readonly HouseholdHomeRecord[]): HouseholdHomeRecord[] {
  const byIdentity = new Map<string, HouseholdHomeRecord>();
  for (const record of records) {
    if (!byIdentity.has(record.identity)) byIdentity.set(record.identity, record);
  }
  return [...byIdentity.values()];
}

type ComposedHouseholdHomeRecord = HouseholdHomeRecord & { family: HouseholdHomeFamily };

function isHouseholdHomeRecord(record: HouseholdHomeRecord): record is ComposedHouseholdHomeRecord {
  return householdHomeFamilySchema.safeParse(record.family).success;
}

function destinationsFor(
  records: readonly ComposedHouseholdHomeRecord[],
): HouseholdHomeDestination[] {
  const destinations = new Map<string, HouseholdHomeDestination>();
  for (const record of records) {
    const destination = householdHomeFamilyDestination(record.family);
    if (destinations.has(destination.href)) continue;
    destinations.set(destination.href, { family: record.family, ...destination });
  }
  return [...destinations.values()];
}
