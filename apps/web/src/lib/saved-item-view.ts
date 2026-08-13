import type { SavedItemWithContext } from "@tendnote/db/queries/saved-items";
import type {
  PrivacyScope,
  RecordSurfacingState,
  SavedItemKind,
  SavedItemOwnership,
} from "@tendnote/domain";
import { resolveRecordSurfacing } from "@tendnote/domain/record-surfacing";
import type { OwnerActionResult } from "@/lib/owner-action";
import type { ReminderScheduleView } from "@/lib/reminder-schedule-view";

export type SavedItemSurfaceState = Extract<RecordSurfacingState, "overdue" | "today" | "upcoming">;

/** Display names for the household members a Saved Item may name, keyed by user id. */
export type SavedItemMemberNames = ReadonlyMap<string, string>;

/**
 * What a member is called when the surface cannot name them - a departed member,
 * or a name the caller was never given. Neutral and factual; a raw user id is
 * never rendered (DESIGN.md §9, ADR 0004).
 */
const UNKNOWN_MEMBER = "a member";

export type SavedItemView = {
  id: string;
  revision: string;
  kind: SavedItemKind;
  kindLabel: string;
  title: string;
  content: string | null;
  url: string | null;
  status: "active" | "archived";
  archived: boolean;
  /** Null when the Household Workspace owns this Saved Item (ADR 0214). */
  ownerUserId: string | null;
  ownership: SavedItemOwnership;
  /** Sent back as `expectedVersion` on a household-native write. */
  version: number;
  owned: boolean;
  /**
   * Whether this viewer may re-author the item at all: edit it, move it through
   * its lifecycle, resolve it, or promote it. Resolved here so no row, form, or
   * control re-derives authority from ownership fields and drifts from the
   * server's answer.
   */
  canEdit: boolean;
  /**
   * Whether this viewer may permanently delete the item's uniquely owned source
   * evidence. Member-owned and theirs only: archive is a household-native item's
   * removal path, so no single member deletes what the household owns (ADR 0214).
   */
  canDeleteEvidence: boolean;
  bringBackAt: string | null;
  bringBackState: SavedItemSurfaceState | null;
  bringBackLabel: string | null;
  scope: PrivacyScope;
  visibilityLabel: string;
  /** How many members a `shared` Saved Item reaches; 0 otherwise. */
  sharedWithCount: number;
  /** "Created by <name>" on a household-native item somebody else wrote. */
  createdByLabel: string | null;
  /** "Last changed by <name>" when the last actor is neither the creator nor the viewer. */
  lastChangedByLabel: string | null;
  sourceRecordId: string;
  resolutionReason: string | null;
  reminderSchedule?: ReminderScheduleView | null;
  outcomes: Array<{
    destinationKind: "general_action";
    destinationRecordId: string;
    label: string;
  }>;
};

const KIND_LABELS: Record<SavedItemKind, string> = {
  note: "Note",
  link: "Link",
  open_question: "Open question",
};

/**
 * Names a member, or says "a member" when the name is unknown.
 *
 * Exported because the conflict reconciliation panel names the last actor from a
 * payload the server deliberately left as an id, and it must fall back to the
 * same neutral word rather than showing one.
 */
export function savedItemMemberLabel(
  userId: string,
  memberNames: SavedItemMemberNames | undefined,
): string {
  return memberNames?.get(userId) ?? UNKNOWN_MEMBER;
}

/**
 * Who this item belongs to, in one quiet line.
 *
 * Three cases, and they are deliberately different sentences. A household-native
 * item is the workspace's, so it says **Household** and names no member. A
 * member-owned item somebody else shared says **Shared by <name>**, which is what
 * makes the absent controls read as "not yours to re-author" rather than a missing
 * feature. The viewer's own item keeps the audience label it always had.
 */
function audienceLabel(
  item: SavedItemWithContext,
  callerUserId: string,
  fallback: string,
  memberNames: SavedItemMemberNames | undefined,
): string {
  if (item.ownership === "household_native") return "Household";
  if (item.ownerUserId !== callerUserId) {
    return `Shared by ${savedItemMemberLabel(item.ownerUserId ?? "", memberNames)}`;
  }
  return fallback;
}

/**
 * Provenance for a household-native item: who wrote it, and who last changed it
 * if that was someone else.
 *
 * Two lines at most, and never about the viewer. This is attribution, not an
 * activity feed, a comment thread, or a fairness ledger - a member should be able
 * to ask the right person about a shared note, and nothing more
 * (`docs/phase-8/household-saved-items.md`).
 */
function provenanceLabels(
  item: SavedItemWithContext,
  callerUserId: string,
  memberNames: SavedItemMemberNames | undefined,
): { createdByLabel: string | null; lastChangedByLabel: string | null } {
  if (item.ownership !== "household_native") {
    return { createdByLabel: null, lastChangedByLabel: null };
  }
  const creator = item.createdByUserId;
  const lastActor = item.lastActorUserId;
  return {
    createdByLabel:
      creator && creator !== callerUserId
        ? `Created by ${savedItemMemberLabel(creator, memberNames)}`
        : null,
    lastChangedByLabel:
      lastActor && lastActor !== creator && lastActor !== callerUserId
        ? `Last changed by ${savedItemMemberLabel(lastActor, memberNames)}`
        : null,
  };
}

export function toSavedItemView(
  item: SavedItemWithContext,
  options: {
    callerUserId: string;
    now?: Date;
    reminderSchedule?: ReminderScheduleView | null;
    memberNames?: SavedItemMemberNames;
  },
): SavedItemView {
  const { callerUserId, now = new Date(), reminderSchedule = null, memberNames } = options;
  const surfacing = resolveRecordSurfacing(
    {
      kind: "saved_item",
      status: item.status,
      bringBackAt: item.bringBackAt,
      ownerUserId: item.ownerUserId,
      viewerUserId: callerUserId,
      scope: item.scope,
      sharedWithCount: item.sharedWithUserIds.length,
      householdName: item.householdName,
      updatedAt: item.updatedAt,
    },
    now,
  );
  const hasActiveBringBack = item.status === "active" && item.bringBackAt !== null;
  const householdNative = item.ownership === "household_native";
  return {
    id: item.id,
    revision: surfacing.revision,
    kind: item.kind,
    kindLabel: KIND_LABELS[item.kind],
    title: item.title,
    content: item.content,
    url: item.url,
    status: item.status,
    archived: item.status === "archived",
    ownerUserId: item.ownerUserId,
    ownership: item.ownership,
    version: item.version,
    owned: surfacing.owned,
    // Every active member has the same standing over a workspace-owned record,
    // and no standing at all over someone else's (ADR 0214).
    canEdit: householdNative || surfacing.owned,
    canDeleteEvidence: !householdNative && surfacing.owned,
    bringBackAt: item.bringBackAt?.toISOString() ?? null,
    bringBackState: hasActiveBringBack ? (surfacing.state as SavedItemSurfaceState) : null,
    bringBackLabel: hasActiveBringBack ? surfacing.timingLabel : null,
    scope: item.scope,
    visibilityLabel: audienceLabel(item, callerUserId, surfacing.audienceLabel, memberNames),
    sharedWithCount: item.sharedWithUserIds.length,
    ...provenanceLabels(item, callerUserId, memberNames),
    sourceRecordId: item.sourceRecordId,
    resolutionReason: item.resolutionReason,
    reminderSchedule,
    outcomes: item.outcomes.map((outcome) => ({
      destinationKind: outcome.destinationKind,
      destinationRecordId: outcome.destinationRecordId,
      label: "General Action",
    })),
  };
}

export type SavedItemMutationResult = OwnerActionResult<SavedItemView>;
