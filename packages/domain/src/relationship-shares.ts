import { z } from "zod";
import type { HouseholdOperation } from "./household-authorization";
import type { Confidence, PrivacyScope, Sensitivity } from "./privacy";

/**
 * The three member-owned records a Relationship Share can expose.
 *
 * Deliberately narrower than `VisibilityRecordKind`: the household-native
 * families (Actions, Saved Items, Assets) are shared by belonging to the
 * workspace, not by a member deciding to show one of their own relationship
 * records. Person is absent because a Person never becomes shareable at all —
 * that is the whole of ADR 0218.
 */
export const relationshipRecordKindSchema = z.enum(["memory", "source_record", "followup"]);
export type RelationshipRecordKind = z.infer<typeof relationshipRecordKindSchema>;

/** What each family is called in the product's own words (DESIGN.md §9). */
export const RELATIONSHIP_RECORD_NOUN: Record<RelationshipRecordKind, string> = {
  memory: "memory",
  source_record: "note",
  followup: "follow-up",
};

/**
 * Everything a Relationship Share confers.
 *
 * A share is read access to one record and nothing else: not ownership, and not
 * the authority to edit it, review it, reach its evidence, change its Person
 * links, change its sensitivity, or take over its reminders. Those are all
 * `update` / `change_audience` / `archive` operations in the Household
 * Authorization Proof, and this function is the reason a surface cannot quietly
 * decide that "they can see it" also means "they can touch it" (ADR 0218).
 */
export function relationshipShareGrants(operation: HouseholdOperation): boolean {
  return operation === "view";
}

/**
 * Whether widening this record's audience needs a second, deliberate yes.
 *
 * Sensitivity is independent of visibility: marking something restricted does
 * not hide it from an audience the owner chose, and choosing an audience does
 * not downgrade it. What restricted content does earn is a confirmation that
 * names who will be able to read it, because the cost of a mistaken share here
 * is the highest in the product.
 */
export function requiresRestrictedShareConfirmation(input: {
  sensitivity: Sensitivity;
  scope: PrivacyScope;
}): boolean {
  return input.sensitivity === "restricted" && input.scope !== "private";
}

/** "Mara", "Mara and Jon", "Mara, Jon, and Sam". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/**
 * The sentence shown beside the second confirmation, naming the audience in
 * full. It states who, plainly, and never warns or scolds — the owner is making
 * a deliberate choice, not being talked out of one (DESIGN.md §2).
 */
export function restrictedShareConfirmationPrompt(input: {
  recordKind: RelationshipRecordKind;
  scope: Extract<PrivacyScope, "shared" | "household">;
  /** Omitted where the surface has not already paid for the household read. */
  householdName?: string | null;
  audienceNames: readonly string[];
}): string {
  const noun = RELATIONSHIP_RECORD_NOUN[input.recordKind];
  if (input.scope === "household") {
    return `Every active member of ${input.householdName ?? "your household"} will be able to read this restricted ${noun}, including anyone who joins later.`;
  }
  const names = joinNames(input.audienceNames);
  const verb = input.audienceNames.length === 1 ? "will" : "will each";
  return `${names} ${verb} be able to read this restricted ${noun}.`;
}

/** What the owner is told when the confirmation is missing. */
export function restrictedShareConfirmationMessage(recordKind: RelationshipRecordKind): string {
  return `Confirm the audience before sharing this restricted ${RELATIONSHIP_RECORD_NOUN[recordKind]}.`;
}

/**
 * A refusal the owner may be shown verbatim.
 *
 * Distinct from an authorization denial, which is always opaque. These are
 * things the owner already knows — that they picked nobody, that a restricted
 * record wants a second yes — so naming them helps rather than discloses.
 */
export class RelationshipShareValidationError extends Error {
  override readonly name = "RelationshipShareValidationError";
}

/** Which audience decision let the reader in, as quiet factual provenance. */
export type SharedRelationshipAudience = "selected_members" | "whole_household";

/**
 * Everything a Relationship Share recipient may be shown, and nothing else.
 *
 * There is no `ownerUserId`, `personId`, `sourceRecordId`, `householdId`,
 * `sensitivity`, `importance`, or status here, and their absence is the
 * feature. A recipient who holds an owner's user id or a person id can go
 * looking; a recipient who holds a display label cannot. `personLabel` is the
 * one identity fact that crosses, because a memory about nobody is unreadable —
 * and it is a label the owner deliberately exposed, never a join back into
 * their private People graph (ADR 0218).
 */
export type SharedRelationshipRecordView = {
  recordKind: RelationshipRecordKind;
  recordId: string;
  /** The deliberately exposed content of this one record. */
  body: string;
  /** A safe display label, or null when the family exposes none. */
  personLabel: string | null;
  recordedAt: Date;
  /** A follow-up's timing; null for the families that have none. */
  dueAt: Date | null;
  /** The record's trust treatment, not a score of the person. */
  trust: Confidence | null;
  sharedByName: string;
  audience: SharedRelationshipAudience;
  /** So the owner's own read does not render as someone else's share. */
  viewerIsOwner: boolean;
};

/**
 * Facts a caller may offer when building a recipient's view.
 *
 * Typed permissively on purpose. Callers hold whole database rows, and a type
 * that forbade the extra fields would only move the leak to the call site's
 * hand-written projection. Instead every caller may pass its row, and this
 * function is the single place that decides what survives.
 */
export type SharedRelationshipRecordInput = {
  recordKind: RelationshipRecordKind;
  recordId: string;
  body: string;
  recordedAt: Date;
  personLabel?: string | null;
  dueAt?: Date | null;
  trust?: Confidence | null;
  sharedByName: string;
  audience: SharedRelationshipAudience;
  viewerIsOwner: boolean;
};

/**
 * Narrows a shared record to the recipient envelope.
 *
 * Field by field, never a spread: a spread would carry whatever the caller's
 * row happens to hold, and the next column added to `memories` would leak
 * without anyone editing this file.
 */
export function toSharedRelationshipRecordView(
  input: SharedRelationshipRecordInput,
): SharedRelationshipRecordView {
  return {
    recordKind: input.recordKind,
    recordId: input.recordId,
    body: input.body,
    // A shared Source Record is evidence. Revealing who it resolved to would
    // disclose a Person link the owner never shared, so this family carries no
    // label at all regardless of what the caller offers.
    personLabel: input.recordKind === "source_record" ? null : (input.personLabel ?? null),
    recordedAt: input.recordedAt,
    dueAt: input.dueAt ?? null,
    trust: input.trust ?? null,
    sharedByName: input.sharedByName,
    audience: input.audience,
    viewerIsOwner: input.viewerIsOwner,
  };
}
