import type {
  AssetSearchResult,
  CalendarEventSummary,
  CalendarReadResult,
  ContextFact,
  ExactRecallResult,
  GlobalRecallResult,
  SavedItemSemanticResult,
  SelfContextCategory,
  SemanticRetrievalResult,
} from "@tendnote/domain";
import { contextFactCategoryLabel } from "@tendnote/domain";
import type { HouseholdContextExactResult, SelfContextExactResult } from "../context-facts/types";
import type { ActiveFollowupSummary } from "../followups/types";
import type { SavedItemWithContext } from "../saved-items/types";

export const RELATED_MINIMUM_SIMILARITY = 0.55;

export function toCalendarResult(
  event: CalendarEventSummary,
  read: CalendarReadResult,
): GlobalRecallResult {
  const id = `${event.calendarId}:${event.providerEventId}`;
  const query = new URLSearchParams({
    calendarId: event.calendarId,
    calendarEvent: event.providerEventId,
    calendarStart: event.start.toISOString(),
  });
  if (event.title) query.set("calendarQuery", event.title);
  return {
    family: "calendar_event",
    canonical: { kind: "calendar_event", id },
    label: event.title ?? "Calendar event",
    supportingText: event.description ?? event.location ?? event.start.toISOString(),
    lifecycle: event.status,
    match: {
      kind: "exact",
      reason: "Matched available Calendar event details",
      excerpt: event.description ?? event.location ?? event.title,
    },
    trust: "provider_context",
    sensitivity: "normal",
    visibility: null,
    grounding: [{ kind: "calendar_event", id }],
    href: `/account?${query.toString()}#calendar-event-${encodeURIComponent(id)}`,
    parent: null,
    details: {
      start: event.start.toISOString(),
      end: event.end.toISOString(),
      allDay: event.allDay,
      status: event.status,
      source: read.source,
      stale: read.stale,
      fetchedAt: read.fetchedAt.toISOString(),
    },
  };
}

export function toFollowupResult(entry: ActiveFollowupSummary): GlobalRecallResult {
  const followup = entry.followup;
  return {
    family: "follow_up",
    canonical: { kind: "follow_up", id: followup.id },
    label: entry.person?.displayName ? `Follow-Up with ${entry.person.displayName}` : "Follow-Up",
    supportingText: followup.reason,
    lifecycle: followup.status,
    match: {
      kind: "exact",
      reason: "Matched person and reminder wording",
      excerpt: followup.reason,
    },
    trust: "follow_up",
    sensitivity: "normal",
    visibility: visibilityForScope(followup.scope),
    grounding: [
      { kind: "follow_up", id: followup.id },
      ...(followup.sourceRecordId
        ? ([{ kind: "source_record", id: followup.sourceRecordId }] as const)
        : []),
    ],
    href: `/people/${followup.personId}#followup-${followup.id}`,
    parent: { kind: "person", id: followup.personId },
    details: {
      dueAt: followup.dueAt.toISOString(),
      cadence: followup.cadence ?? null,
      personDisplayName: entry.person?.displayName ?? null,
    },
  };
}

export function toExactSavedItemResult(item: SavedItemWithContext): GlobalRecallResult {
  return {
    family: "saved_item",
    canonical: { kind: "saved_item", id: item.id },
    label: item.title,
    supportingText: item.content ?? item.url ?? item.title,
    lifecycle: item.status,
    match: {
      kind: "exact",
      reason: "Matched Saved Item wording",
      excerpt: item.content ?? item.url ?? item.title,
    },
    trust: "saved_context",
    sensitivity: "normal",
    visibility: visibilityForScope(item.scope),
    grounding: [
      { kind: "saved_item", id: item.id },
      { kind: "source_record", id: item.sourceRecordId },
    ],
    href: `/saved-items#saved-item-${item.id}`,
    parent: null,
    details: { kind: item.kind },
  };
}

export function toRelatedSavedItemResult(item: SavedItemSemanticResult): GlobalRecallResult {
  return {
    family: "saved_item",
    canonical: { kind: "saved_item", id: item.savedItemId },
    label: item.title,
    supportingText: item.snippet,
    lifecycle: item.status,
    match: { kind: "related", reason: "Related by meaning", excerpt: item.snippet },
    trust: "saved_context",
    sensitivity: "normal",
    visibility: visibilityForScope(item.scope),
    grounding: [{ kind: "saved_item", id: item.savedItemId }],
    href: `/saved-items#saved-item-${item.savedItemId}`,
    parent: null,
    details: { kind: null },
  };
}

export type SelfContextResultSource = {
  fact: Omit<
    Pick<ContextFact, "id" | "category" | "content" | "lifecycle" | "sensitivity">,
    "category"
  > & {
    category: SelfContextCategory;
    provenance: Pick<ContextFact["provenance"], "channel" | "origin">;
  };
  matchedFields: readonly ("content" | "category")[];
};

export function toSelfContextResult(
  source: SelfContextExactResult | SelfContextResultSource,
): GlobalRecallResult {
  const { fact, matchedFields } = source;
  const categoryLabel = contextFactCategoryLabel(fact.category);
  return {
    family: "self_context",
    canonical: { kind: "context_fact", id: fact.id },
    label: fact.content,
    supportingText: categoryLabel,
    lifecycle: fact.lifecycle,
    match: {
      kind: "exact",
      reason: matchedFields.length
        ? `Matched Self Context ${matchedFields.join(" and ")}`
        : "Matched Self Context",
      excerpt: fact.content,
    },
    trust: "self_context",
    sensitivity: fact.sensitivity,
    visibility: { choice: "only_me", label: "Only me" },
    grounding: [{ kind: "context_fact", id: fact.id }],
    href: `/account/about-you#context-fact-${encodeURIComponent(fact.id)}`,
    parent: null,
    details: {
      content: fact.content,
      category: fact.category,
      categoryLabel,
      provenance: {
        channel: fact.provenance.channel,
        origin: fact.provenance.origin,
      },
    },
  };
}

/**
 * Household Context as an exact recall result.
 *
 * Deliberately not folded into `toSelfContextResult` despite the two carrying
 * the same fields. The subject is the whole difference: a household statement
 * belongs to everyone active in the workspace, so it says "Whole household"
 * where a self statement says "Only me", it names Household Context in its
 * match reason, and it links to the household management page rather than
 * About you. Two members can hold the same words about themselves and about
 * the household, and a reader has to be able to tell which one they are
 * reading without opening it.
 */
export function toHouseholdContextResult(source: HouseholdContextExactResult): GlobalRecallResult {
  const { fact, matchedFields } = source;
  const categoryLabel = contextFactCategoryLabel(fact.category);
  return {
    family: "household_context",
    canonical: { kind: "context_fact", id: fact.id },
    label: fact.content,
    supportingText: categoryLabel,
    lifecycle: fact.lifecycle,
    match: {
      kind: "exact",
      reason: matchedFields.length
        ? `Matched Household Context ${matchedFields.join(" and ")}`
        : "Matched Household Context",
      excerpt: fact.content,
    },
    trust: "household_context",
    sensitivity: fact.sensitivity,
    // Household Context has one audience by construction - every active member,
    // including whoever joins next - so it takes the household scope's own
    // visibility rather than restating a choice the fact never made.
    visibility: visibilityForScope("household"),
    grounding: [{ kind: "context_fact", id: fact.id }],
    href: `/account/household/context#household-context-fact-${encodeURIComponent(fact.id)}`,
    parent: null,
    details: {
      content: fact.content,
      category: fact.category,
      categoryLabel,
      provenance: {
        channel: fact.provenance.channel,
        origin: fact.provenance.origin,
      },
    },
  };
}

export function toAssetResult(result: AssetSearchResult): GlobalRecallResult {
  const matchKind = result.matchKinds.some((kind) => kind === "exact" || kind === "structured")
    ? "exact"
    : "related";
  if (result.recordKind === "asset_memory") {
    return {
      family: "asset_memory",
      canonical: { kind: "asset_memory", id: result.recordId },
      label: result.label,
      supportingText: result.snippet,
      lifecycle: result.assetStatus,
      match: { kind: matchKind, reason: assetMatchReason(result), excerpt: result.snippet },
      trust: "asset_fact",
      sensitivity: "normal",
      visibility: visibilityFor(result),
      grounding: result.citations,
      href: `/assets/${result.assetId}#asset-memory-${result.recordId}`,
      parent: { kind: "asset", id: result.assetId },
      details: {
        assetId: result.assetId,
        assetName: result.assetName,
        assetKind: result.assetKind,
        value: result.value,
      },
    };
  }
  return {
    family: "asset",
    canonical: { kind: "asset", id: result.assetId },
    label: result.assetName,
    supportingText: result.snippet,
    lifecycle: result.assetStatus,
    match: { kind: matchKind, reason: assetMatchReason(result), excerpt: result.snippet },
    trust: "asset_anchor",
    sensitivity: "normal",
    visibility: visibilityFor(result),
    grounding: result.citations,
    href: `/assets/${result.assetId}`,
    parent: null,
    details: { assetKind: result.assetKind },
  };
}

export function isResult(result: GlobalRecallResult | null): result is GlobalRecallResult {
  return result !== null;
}

export function toExactRelationshipResult(result: ExactRecallResult): GlobalRecallResult | null {
  return toRelationshipResult({
    ...result,
    label:
      result.recordKind === "source_record"
        ? (result.relatedPersonDisplayName ?? result.label)
        : result.label,
    match: {
      kind: "exact",
      reason: `Matched ${result.matchedFields.join(", ")}`,
      excerpt: result.snippet,
    },
    grounding: exactRelationshipGrounding(result),
  });
}

export function toRelatedRelationshipResult(
  result: SemanticRetrievalResult,
): GlobalRecallResult | null {
  if (result.similarity < RELATED_MINIMUM_SIMILARITY) return null;
  return relatedRelationshipCandidate(result);
}

/**
 * The record a semantic candidate would become if the similarity floor let it
 * through. Limitation reporting needs this for candidates the floor rejected, so
 * it can tell a record that was actually lost from one the Exact pass already put
 * on screen under the same canonical id.
 */
export function relatedRelationshipCandidate(
  result: SemanticRetrievalResult,
): GlobalRecallResult | null {
  return toRelationshipResult({
    ...result,
    label:
      result.recordKind === "source_record"
        ? (result.relatedPersonDisplayName ?? "Logged context")
        : result.recordKind === "memory"
          ? (result.relatedPersonDisplayName ?? "Confirmed memory")
          : result.snippet,
    match: { kind: "related", reason: "Related by meaning", excerpt: result.snippet },
    grounding: result.sourceRefs,
  });
}

type RelationshipCandidate = {
  recordKind: "person" | "source_record" | "memory" | "general_action";
  recordId: string;
  label: string;
  snippet: string;
  sensitivity: "normal" | "sensitive" | "restricted";
  visibilityChoice: "only_me" | "selected_members" | "whole_household" | null;
  visibilityLabel: string | null;
  relatedPersonId: string | null;
  relatedPersonDisplayName: string | null;
  generalAction?: {
    status: string;
    isRoutine: boolean;
    isSuggested: boolean;
    areaId: string | null;
  } | null;
  match: GlobalRecallResult["match"];
  grounding: GlobalRecallResult["grounding"];
};

function toRelationshipResult(result: RelationshipCandidate): GlobalRecallResult | null {
  const common = {
    label: result.label,
    supportingText: result.snippet,
    lifecycle: "active",
    match: result.match,
    sensitivity: result.sensitivity,
    visibility: visibilityFor(result),
    grounding: result.grounding,
  } as const;
  if (result.recordKind === "person") {
    return {
      ...common,
      family: "person",
      canonical: { kind: "person", id: result.recordId },
      trust: "identity_reference",
      visibility: null,
      href: `/people/${result.recordId}`,
      parent: null,
      details: { displayName: result.label },
    };
  }
  if (result.recordKind === "source_record") {
    if (!result.relatedPersonId) return null;
    return {
      ...common,
      family: "relationship_context",
      canonical: { kind: "person", id: result.relatedPersonId },
      trust: "logged_context",
      href: `/people/${result.relatedPersonId}`,
      parent: null,
      details: {
        contextKind: "logged_context",
        personDisplayName: result.relatedPersonDisplayName,
      },
    };
  }
  if (result.recordKind === "general_action") {
    return {
      ...common,
      family: "general_action",
      canonical: { kind: "general_action", id: result.recordId },
      lifecycle: result.generalAction?.status ?? "active",
      trust: "action_item",
      href: `/actions#action-${result.recordId}`,
      parent: null,
      details: {
        status: result.generalAction?.status ?? "open",
        isRoutine: result.generalAction?.isRoutine ?? false,
        isSuggested: result.generalAction?.isSuggested ?? false,
        areaId: result.generalAction?.areaId ?? null,
      },
    };
  }
  return {
    ...common,
    family: "relationship_context",
    canonical: { kind: "memory", id: result.recordId },
    trust: "confirmed_fact",
    href: result.relatedPersonId
      ? `/people/${result.relatedPersonId}#memory-${encodeURIComponent(result.recordId)}`
      : "/people",
    parent: result.relatedPersonId ? { kind: "person", id: result.relatedPersonId } : null,
    details: { contextKind: "memory", personDisplayName: result.relatedPersonDisplayName },
  };
}

function exactRelationshipGrounding(result: ExactRecallResult): GlobalRecallResult["grounding"] {
  if (result.recordKind === "source_record") {
    return [{ kind: "source_record", id: result.recordId }];
  }
  return [{ kind: result.recordKind, id: result.recordId }];
}

function assetMatchReason(result: AssetSearchResult): string {
  if (result.matchKinds.includes("structured")) return "Matched an exact Asset value";
  if (result.matchKinds.includes("exact")) return `Matched ${result.matchedFields.join(", ")}`;
  return "Related by meaning";
}

function visibilityForScope(scope: "private" | "shared" | "household") {
  if (scope === "private") return { choice: "only_me" as const, label: "Only me" };
  if (scope === "shared") {
    return { choice: "selected_members" as const, label: "Specific people" };
  }
  return { choice: "whole_household" as const, label: "Whole household" };
}

function visibilityFor(result: {
  visibilityChoice: "only_me" | "selected_members" | "whole_household" | null;
  visibilityLabel: string | null;
}) {
  return result.visibilityChoice && result.visibilityLabel
    ? { choice: result.visibilityChoice, label: result.visibilityLabel }
    : null;
}
