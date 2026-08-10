import type {
  Confidence,
  HouseholdRecordLifecycle,
  PrivacyScope,
  RelationshipRecordKind,
  Sensitivity,
  VisibilityChoice,
} from "@tendnote/domain";
import type { HouseholdStore } from "../households/types";

/**
 * One relationship record, described in the terms sharing needs and no others.
 *
 * The three families store their content under different column names — a
 * memory's `content`, a source record's `content`, a follow-up's `reason` — and
 * normalizing them here is what lets one share seam serve all three without
 * three copies of the privacy rules. The privacy-relevant facts (`scope`,
 * `householdId`, `sensitivity`, `lifecycle`) are carried verbatim so the
 * Household Authorization Proof decides on the record's own facts, not on
 * anything the caller supplied.
 */
export type RelationshipRecordFacts = {
  recordKind: RelationshipRecordKind;
  recordId: string;
  ownerUserId: string;
  /** Null for source records, which never expose a person through a share. */
  personId: string | null;
  scope: PrivacyScope;
  householdId: string | null;
  sensitivity: Sensitivity;
  lifecycle: HouseholdRecordLifecycle;
  /**
   * Whether the owner has actually settled this record.
   *
   * An unreviewed suggestion is the assistant's guess, not the owner's memory,
   * and a household should never read one as the latter. Separate from
   * `lifecycle` because a suggestion is not gone — it is not yet the owner's.
   */
  shareable: boolean;
  body: string;
  recordedAt: Date;
  trust: Confidence | null;
  dueAt: Date | null;
};

export type RelationshipShareStore = HouseholdStore & {
  /**
   * Reads one relationship record by id, with **no owner filter**.
   *
   * That is deliberate and safe: an audience member is by definition not the
   * owner, so an owner-keyed read could never serve them. The proof above this
   * call, not the query, is what decides whether the row may be revealed —
   * the same division `provenVisibleRecord` makes.
   */
  getRelationshipRecord: (input: {
    recordKind: RelationshipRecordKind;
    recordId: string;
  }) => Promise<RelationshipRecordFacts | null>;
  /** Owner-keyed, so a non-owner cannot re-address a record even by mistake. */
  updateRelationshipRecordVisibility: (input: {
    recordKind: RelationshipRecordKind;
    recordId: string;
    ownerUserId: string;
    scope: PrivacyScope;
    householdId: string | null;
  }) => Promise<void>;
  /**
   * The owner's own label for a person, read against the owner's People graph.
   *
   * Owner-keyed on purpose: the label that crosses a share is the one the
   * record's owner deliberately exposed. A recipient's own Person for the same
   * human is a different record and is never consulted (ADR 0218).
   */
  getPersonDisplayLabel: (input: {
    ownerUserId: string;
    personId: string;
  }) => Promise<string | null>;
  /** For "Shared by Mara" — a name, never an account identifier. */
  getMemberDisplayName: (input: { userId: string }) => Promise<string | null>;
};

/** What the owner's sharing control needs to render its current state. */
export type RelationshipShareState = {
  recordKind: RelationshipRecordKind;
  recordId: string;
  scope: PrivacyScope;
  visibilityChoice: VisibilityChoice;
  selectedUserIds: string[];
  sensitivity: Sensitivity;
  householdName: string | null;
};

export type ShareRelationshipRecordInput = {
  ownerUserId: string;
  recordKind: RelationshipRecordKind;
  recordId: string;
  visibilityChoice: VisibilityChoice;
  selectedUserIds?: string[];
  /** The owner's second yes, required only for restricted content. */
  confirmedRestricted?: boolean;
};
