import {
  assistantToolResultSchemas,
  type MemoryCuratorToolResult,
  type RelationshipAgendaToolResult,
  type SuggestedMemoryReviewItemOutput,
} from "@tendnote/domain";
import Link from "next/link";
import { AgendaCalendar } from "@/components/agenda-calendar";
import { Body, Caption, ResultCard } from "@/components/assistant-result-card";
import {
  BookOpenIcon,
  CalendarDotsIcon,
  CheckIcon,
  ClipboardTextIcon,
  ListTodoIcon,
  NotebookPenIcon,
  SearchIcon,
  UserIcon,
  UserPenIcon,
  UserPlusIcon,
} from "@/components/icons";
import { labelSensitivity } from "@/lib/eve/agenda-format";
import { formatFieldList, PERSON_FIELD_LABEL } from "@/lib/eve/person-fields";
import type {
  AssistantToolView,
  MemoryCuratorProposalView,
  RelationshipContextSearchResultView,
  SemanticContextSearchResultView,
  SuggestedReviewItemView,
} from "@/lib/eve/tool-result-view";
import { defineModule } from "./module";
import { flagIsFalse, formatDueLabel } from "./shared";
import { DisclosureShell, ToolActivityLine } from "./shells";

/**
 * Relationship-memory result modules (#225): Source Record and Memory capture,
 * people, person context, Exact Recall, Semantic Retrieval, Relationship Agenda,
 * Suggested Memory review, and Memory Curator proposals. Each module keeps its own
 * validation, projection, trust treatment, visual weight, identity, and rendering,
 * so Approved Memory, Logged Context, and tentative suggestion tiers stay distinct
 * and no caller re-derives them.
 */

// ---------------------------------------------------------------------------
// Projections (persisted output → view)
// ---------------------------------------------------------------------------

function toReviewItem(parsed: SuggestedMemoryReviewItemOutput): SuggestedReviewItemView {
  return {
    memoryId: parsed.memory.id,
    content: parsed.memory.content,
    sourceRecordId: parsed.memory.sourceRecordId ?? null,
    personId: parsed.person?.id ?? parsed.memory.personId ?? null,
    personName: parsed.person?.displayName ?? null,
  };
}

function toMemoryCuratorProposal(
  proposal: MemoryCuratorToolResult["proposals"][number],
): MemoryCuratorProposalView {
  return {
    id: proposal.id,
    proposalKind: proposal.kind,
    personId: proposal.personId ?? null,
    personDisplayName: proposal.personDisplayName ?? null,
    title: proposal.title,
    reason: proposal.reason,
    suggestedAction: proposal.suggestedAction,
    sourceRefs: proposal.sourceRefs,
    sensitivity: proposal.sensitivity,
    reviewOnly: proposal.reviewOnly,
  };
}

type RelationshipAgendaCandidateView = Extract<
  AssistantToolView,
  { kind: "relationship_agenda" }
>["candidates"][number];

function toRelationshipAgendaCandidate(
  candidate: RelationshipAgendaToolResult["candidates"][number],
): RelationshipAgendaCandidateView {
  return {
    ...candidate,
    personId: candidate.personId ?? null,
    personDisplayName: candidate.personDisplayName ?? null,
    dueAt: candidate.dueAt ?? null,
    dueLabel: candidate.dueAt ? formatDueLabel(candidate.dueAt) : null,
    visibilityChoice: candidate.visibilityChoice ?? null,
    visibilityLabel: candidate.visibilityLabel ?? null,
  };
}

/**
 * Refresh-stable key for one agenda candidate: its grounding record when it has
 * one, else its kind + rank + person, so an undated, sourceless candidate still
 * keys on real fields rather than array position.
 */
export function relationshipAgendaCandidateKey(candidate: RelationshipAgendaCandidateView): string {
  const sourceKey = candidate.sourceRefs
    .map((sourceRef) => `${sourceRef.kind}:${sourceRef.id}`)
    .join(":");

  return sourceKey || `${candidate.kind}:${candidate.rank}:${candidate.personId ?? "personless"}`;
}

// ---------------------------------------------------------------------------
// Shared presentational bits
// ---------------------------------------------------------------------------

type SearchResultView = RelationshipContextSearchResultView | SemanticContextSearchResultView;

/**
 * The record families recall can return, in the words the product uses for them.
 * A General Action is an ordinary recall result (ADR 0150) and belongs here beside
 * People and Memories rather than being a kind the card cannot name.
 */
const RECORD_KIND_LABELS: Record<SearchResultView["recordKind"], string> = {
  person: "Person",
  memory: "Memory",
  source_record: "Source record",
  general_action: "Action",
};

function labelRecordKind(kind: SearchResultView["recordKind"]): string {
  return RECORD_KIND_LABELS[kind];
}

/**
 * The trust register a row was found under. `action_item` is its own register: an
 * Action is something the user meant to do, not a confirmed fact about a person and
 * not logged context, so it reads as what it is rather than borrowing either.
 */
const TRUST_LABELS: Record<SearchResultView["trustLevel"], string> = {
  identity_reference: "Identity reference",
  confirmed_fact: "Confirmed fact",
  logged_context: "Logged context",
  action_item: "On your list",
};

function labelTrust(result: SearchResultView): string {
  const trust = TRUST_LABELS[result.trustLevel];

  return result.relatedPersonDisplayName ? `${trust} · ${result.relatedPersonDisplayName}` : trust;
}

/**
 * Where a row opens. An Action deep-links to its own ledger row — the same
 * destination Global Recall and the created-action card send it to — because a
 * person link would open the wrong record for an action that merely names someone.
 */
function searchResultHref(result: SearchResultView): string | null {
  if (result.recordKind === "general_action") return `/actions#action-${result.recordId}`;
  return result.relatedPersonId ? `/people/${result.relatedPersonId}` : null;
}

function searchResultIcon(kind: SearchResultView["recordKind"]) {
  if (kind === "person") {
    return <UserIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (kind === "general_action") {
    return <ListTodoIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <NotebookPenIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
}

function SearchResultRow({
  result,
  mode,
}: {
  result: SearchResultView;
  mode: "exact" | "semantic";
}) {
  const href = searchResultHref(result);
  const label =
    "label" in result
      ? result.label
      : (result.relatedPersonDisplayName ?? labelRecordKind(result.recordKind));
  const title = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {searchResultIcon(result.recordKind)}
      <span className="truncate font-medium text-foreground">{label}</span>
    </span>
  );

  return (
    <div className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center justify-between gap-2">
        {href ? (
          <Link
            href={href}
            className="min-w-0 underline decoration-foreground/25 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            {title}
          </Link>
        ) : (
          title
        )}
        <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[length:var(--text-caption)] text-muted-foreground">
          {labelRecordKind(result.recordKind)}
        </span>
      </div>
      <Body>
        {result.trustLevel === "logged_context" ? (
          <span className="text-muted-foreground">You noted: </span>
        ) : null}
        {result.snippet}
      </Body>
      <Caption>
        {[
          labelTrust(result),
          result.visibilityLabel,
          mode === "semantic" ? labelSensitivity(result.sensitivity) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Caption>
    </div>
  );
}

function searchDisclosureSummary(count: number, isSemantic: boolean): string {
  const noun = isSemantic ? "semantic match" : "exact match";
  return count === 1
    ? `Found 1 ${noun}`
    : `Found ${count} ${isSemantic ? "semantic matches" : "exact matches"}`;
}

function renderSearchDisclosure(
  view: Extract<
    AssistantToolView,
    { kind: "relationship_context_search" | "semantic_context_search" }
  >,
  isNew: boolean,
) {
  const isSemantic = view.kind === "semantic_context_search";
  return (
    <DisclosureShell
      icon={<SearchIcon aria-hidden className="size-3.5 shrink-0" />}
      isNew={isNew}
      summary={searchDisclosureSummary(view.results.length, isSemantic)}
      toolView={view.kind}
    >
      <div className="flex flex-col divide-y divide-border/70 border-t px-3.5 pt-3 pb-3.5">
        {view.results.map((result) => (
          <SearchResultRow
            key={`${result.recordKind}:${result.recordId}`}
            mode={isSemantic ? "semantic" : "exact"}
            result={result}
          />
        ))}
      </div>
    </DisclosureShell>
  );
}

function summarizeTiers(view: Extract<AssistantToolView, { kind: "person_context" }>): string {
  const parts: string[] = [];
  if (view.approvedCount > 0) parts.push(`${view.approvedCount} confirmed`);
  if (view.loggedCount > 0) parts.push(`${view.loggedCount} logged`);
  if (view.suggestedCount > 0) parts.push(`${view.suggestedCount} to review`);

  return parts.length > 0 ? parts.join(" · ") : "Nothing recorded yet";
}

/**
 * Plain-language freshness for a recalled person's context snapshot — the cache the
 * recall read from. Kept in the brand's everyday voice (no "snapshot: fresh" mono
 * jargon): a rebuilt or fallback cache reads as recently refreshed or drawn straight
 * from the records, so the user knows how current the recall is.
 */
function labelSnapshotFreshness(snapshotStatus: string): string {
  switch (snapshotStatus) {
    case "fresh":
      return "up to date";
    case "rebuilt":
      return "just refreshed";
    case "fallback":
      return "read from your records";
    default:
      return snapshotStatus;
  }
}

function labelMemoryCuratorSourceKind(kind: "memory" | "source_record"): string {
  return kind === "memory" ? "Memory" : "Source record";
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

/** Logged context: saved for review, never presented as a confirmed fact (ADR 0005). */
export const savedSourceRecordModule = defineModule<"saved_source_record">({
  kind: "saved_source_record",
  parsers: {
    capture_source_record: (output) => {
      const parsed = assistantToolResultSchemas.capture_source_record.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "saved_source_record",
        sourceRecordId: parsed.data.sourceRecord.id,
        content: parsed.data.sourceRecord.content,
        linkedPersonId: parsed.data.linkedPersonId ?? null,
      };
    },
  },
  tier: () => "card",
  key: (view) => `source:${view.sourceRecordId}`,
  groupable: true,
  // A logged note linked to a person can be promoted or dismissed inline (routed to
  // ChatLoggedNoteCard at the client seam); a personless note falls back to this card.
  interactive: true,
  render: (view, isNew) => (
    <ResultCard
      footer={<Caption>Logged context, saved for review. Not a confirmed fact.</Caption>}
      icon={<NotebookPenIcon className="size-3" />}
      isNew={isNew}
      kind={view.kind}
      label="Logged"
      tone="neutral"
    >
      <Body>
        <span className="text-muted-foreground">You noted: </span>
        {view.content}
      </Body>
    </ResultCard>
  ),
});

/** Approved Memory: a confirmed fact, grounded in a source record when it has one. */
export const savedMemoryModule = defineModule<"saved_memory">({
  kind: "saved_memory",
  parsers: {
    capture_memory: (output) => {
      const parsed = assistantToolResultSchemas.capture_memory.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "saved_memory",
        memoryId: parsed.data.memory.id,
        sourceRecordId: parsed.data.memory.sourceRecordId ?? null,
        personId: parsed.data.person?.id ?? null,
        personName: parsed.data.person?.displayName ?? null,
        content: parsed.data.memory.content,
      };
    },
  },
  tier: () => "card",
  key: (view) => `memory:${view.memoryId}`,
  groupable: true,
  render: (view, isNew) => (
    <ResultCard
      footer={
        <Caption>
          Confirmed fact{view.personName ? ` · ${view.personName}` : ""}
          {view.sourceRecordId ? " · grounded in a source record" : ""}
        </Caption>
      }
      icon={<CheckIcon className="size-3" />}
      isNew={isNew}
      kind={view.kind}
      label="Saved to memory"
      tone="confirmed"
    >
      <Body>{view.content}</Body>
    </ResultCard>
  ),
});

export const addedPersonModule = defineModule<"added_person">({
  kind: "added_person",
  parsers: {
    create_person: (output) => {
      const parsed = assistantToolResultSchemas.create_person.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "added_person",
        personId: parsed.data.person.id,
        displayName: parsed.data.person.displayName,
        relationshipType: parsed.data.person.relationshipType ?? null,
      };
    },
  },
  tier: () => "card",
  key: (view) => `person:${view.personId}`,
  groupable: true,
  render: (view, isNew) => (
    <ResultCard
      footer={view.relationshipType ? <Caption>{view.relationshipType}</Caption> : undefined}
      icon={<UserPlusIcon className="size-3" />}
      isNew={isNew}
      kind={view.kind}
      label="Added to your notebook"
      tone="confirmed"
    >
      <Body>{view.displayName}</Body>
    </ResultCard>
  ),
});

export const updatedPersonModule = defineModule<"updated_person">({
  kind: "updated_person",
  parsers: {
    update_person: (output) => {
      const parsed = assistantToolResultSchemas.update_person.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "updated_person",
        personId: parsed.data.person.id,
        displayName: parsed.data.person.displayName,
        relationshipType: parsed.data.person.relationshipType ?? null,
        updatedFields: parsed.data.updatedFields,
      };
    },
  },
  negativeOutcome: {
    matches: (output) => flagIsFalse(output, "updated"),
    note: "No changes were needed",
  },
  tier: () => "card",
  key: (view) => `person-updated:${view.personId}:${view.updatedFields.join(",")}`,
  groupable: true,
  render: (view, isNew) => {
    const fields = view.updatedFields.map((field) => PERSON_FIELD_LABEL[field] ?? field);
    return (
      <ResultCard
        footer={
          fields.length > 0 ? <Caption>Updated {formatFieldList(fields)}</Caption> : undefined
        }
        icon={<UserPenIcon className="size-3" />}
        isNew={isNew}
        kind={view.kind}
        label="Updated in your notebook"
        tone="confirmed"
      >
        <Body>{view.displayName}</Body>
      </ResultCard>
    );
  },
});

/** Ambient recall: a quiet line naming who was recalled and the tier counts. */
export const personContextModule = defineModule<"person_context">({
  kind: "person_context",
  parsers: {
    get_person_context: (output) => {
      const parsed = assistantToolResultSchemas.get_person_context.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "person_context",
        personId: parsed.data.person.id,
        personName: parsed.data.person.displayName,
        snapshotStatus: parsed.data.snapshotStatus,
        approvedCount: parsed.data.approvedMemories.length,
        loggedCount: parsed.data.sourceRecords.length,
        suggestedCount: parsed.data.suggestedMemories.length,
      };
    },
  },
  // A recall of one person, not a result set: it summarizes a single record's tier
  // counts, so it stays an ambient line rather than promoting to a disclosure the way
  // the list-shaped searches and ledgers do.
  negativeOutcome: {
    matches: (output) => flagIsFalse(output, "found"),
    note: "No matching person to recall",
  },
  tier: () => "line",
  key: (view) => `context:${view.personId}`,
  render: (view, isNew) => (
    <ToolActivityLine icon={<BookOpenIcon aria-hidden className="size-3.5" />} isNew={isNew}>
      Recalled {view.personName ?? "this person"}
      <span className="text-muted-foreground/80"> · {summarizeTiers(view)}</span>
      <span className="ml-1.5 text-[length:var(--text-caption)] text-muted-foreground/70">
        · {labelSnapshotFreshness(view.snapshotStatus)}
      </span>
    </ToolActivityLine>
  ),
});

/** Tentative Suggested Memory — routed to the interactive ChatReviewCard at the client seam. */
export const suggestedMemoryReviewModule = defineModule<"suggested_memory_review">({
  kind: "suggested_memory_review",
  parsers: {
    get_suggested_memory_review: (output) => {
      const parsed = assistantToolResultSchemas.get_suggested_memory_review.safeParse(output);
      if (!parsed.success) return null;
      return { kind: "suggested_memory_review", ...toReviewItem(parsed.data) };
    },
  },
  negativeOutcome: {
    matches: (output) => flagIsFalse(output, "found"),
    note: "No suggestion to review",
  },
  tier: () => "card",
  key: (view) => `suggested:${view.memoryId}`,
  interactive: true,
});

export const suggestedMemoryReviewListModule = defineModule<"suggested_memory_review_list">({
  kind: "suggested_memory_review_list",
  parsers: {
    list_suggested_memory_reviews: (output) => {
      const parsed = assistantToolResultSchemas.list_suggested_memory_reviews.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "suggested_memory_review_list",
        reviews: parsed.data.reviews.map(toReviewItem),
      };
    },
  },
  negativeOutcome: {
    matches: (output) => flagIsFalse(output, "found"),
    note: "Nothing to review",
  },
  tier: () => "card",
  key: (view) => `suggested-list:${view.reviews.map((review) => review.memoryId).join(":")}`,
  interactive: true,
});

/** Exact Recall: grounded records, each with its own trust register. */
export const relationshipContextSearchModule = defineModule<"relationship_context_search">({
  kind: "relationship_context_search",
  parsers: {
    search_relationship_context: (output) => {
      const parsed = assistantToolResultSchemas.search_relationship_context.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "relationship_context_search",
        results: parsed.data.results.map((result) => ({
          ...result,
          relatedPersonId: result.relatedPersonId ?? null,
          relatedPersonDisplayName: result.relatedPersonDisplayName ?? null,
        })),
      };
    },
  },
  tier: (view) => (view.results.length > 0 ? "disclosure" : "line"),
  key: (view) => `search:${view.results.map((result) => result.recordId).join(":")}`,
  render: (view, isNew) =>
    view.results.length > 0 ? (
      renderSearchDisclosure(view, isNew)
    ) : (
      <ToolActivityLine icon={<SearchIcon aria-hidden className="size-3.5" />} isNew={isNew}>
        Nothing matching in your notebook
      </ToolActivityLine>
    ),
});

/** Semantic Retrieval: grounded records found by meaning, ids never shown. */
export const semanticContextSearchModule = defineModule<"semantic_context_search">({
  kind: "semantic_context_search",
  parsers: {
    search_semantic_context: (output) => {
      const parsed = assistantToolResultSchemas.search_semantic_context.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "semantic_context_search",
        results: parsed.data.results.map((result) => ({
          ...result,
          relatedPersonId: result.relatedPersonId ?? null,
          relatedPersonDisplayName: result.relatedPersonDisplayName ?? null,
        })),
      };
    },
  },
  tier: (view) => (view.results.length > 0 ? "disclosure" : "line"),
  key: (view) => `semantic-search:${view.results.map((result) => result.recordId).join(":")}`,
  render: (view, isNew) =>
    view.results.length > 0 ? (
      renderSearchDisclosure(view, isNew)
    ) : (
      <ToolActivityLine icon={<SearchIcon aria-hidden className="size-3.5" />} isNew={isNew}>
        No semantic matches found
      </ToolActivityLine>
    ),
});

/** Relationship Agenda: a calendar of grounded and tentative candidates over a window. */
export const relationshipAgendaModule = defineModule<"relationship_agenda">({
  kind: "relationship_agenda",
  parsers: {
    get_relationship_agenda: (output) => {
      const parsed = assistantToolResultSchemas.get_relationship_agenda.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "relationship_agenda",
        candidates: parsed.data.candidates.map(toRelationshipAgendaCandidate),
        window: parsed.data.window
          ? { start: parsed.data.window.start, end: parsed.data.window.end }
          : null,
      };
    },
  },
  tier: (view) => (view.candidates.length > 0 ? "disclosure" : "line"),
  key: (view) => `agenda:${view.candidates.map(relationshipAgendaCandidateKey).join(":")}`,
  render: (view, isNew) => {
    if (view.candidates.length === 0) {
      return (
        <ToolActivityLine
          icon={<CalendarDotsIcon aria-hidden className="size-3.5" />}
          isNew={isNew}
        >
          Nothing on the relationship agenda for that window
        </ToolActivityLine>
      );
    }
    const count = view.candidates.length;
    return (
      <DisclosureShell
        icon={<CalendarDotsIcon aria-hidden className="size-3.5 shrink-0" />}
        isNew={isNew}
        summary={count === 1 ? "Found 1 agenda item" : `Found ${count} agenda items`}
        toolView={view.kind}
      >
        <div className="border-t">
          <AgendaCalendar candidates={view.candidates} window={view.window ?? null} />
        </div>
      </DisclosureShell>
    );
  },
});

/** Memory Curator: review-only cleanup proposals; nothing is changed. */
export const memoryCuratorProposalsModule = defineModule<"memory_curator_proposals">({
  kind: "memory_curator_proposals",
  parsers: {
    propose_memory_cleanup: (output) => {
      const parsed = assistantToolResultSchemas.propose_memory_cleanup.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "memory_curator_proposals",
        proposals: parsed.data.proposals.map(toMemoryCuratorProposal),
      };
    },
  },
  // A card, not a disclosure, even though it is list-shaped: these are trust-bearing
  // review proposals the user is meant to read and act on, so they stay open on a card
  // rather than collapsing behind a summary like an ambient search result set.
  tier: (view) => (view.proposals.length > 0 ? "card" : "line"),
  key: (view) => `memory-curator:${view.proposals.map((proposal) => proposal.id).join(":")}`,
  render: (view, isNew) => {
    if (view.proposals.length === 0) {
      return (
        <ToolActivityLine
          icon={<ClipboardTextIcon aria-hidden className="size-3.5" />}
          isNew={isNew}
        >
          No memory cleanup proposals found
        </ToolActivityLine>
      );
    }
    const count = view.proposals.length;
    return (
      <ResultCard
        footer={<Caption>Review-only cleanup proposals · no memories changed</Caption>}
        icon={<ClipboardTextIcon className="size-3" />}
        isNew={isNew}
        kind={view.kind}
        label={count === 1 ? "Memory cleanup proposal" : "Memory cleanup proposals"}
        tone="neutral"
      >
        <div className="flex flex-col gap-3">
          {view.proposals.map((proposal) => (
            <div className="flex flex-col gap-1.5" key={proposal.id}>
              <Body>{proposal.title}</Body>
              <Caption>{proposal.reason}</Caption>
              <Caption>Suggested review: {proposal.suggestedAction}</Caption>
              <Caption>
                Grounded in{" "}
                {proposal.sourceRefs
                  .map(
                    (sourceRef) =>
                      `${labelMemoryCuratorSourceKind(sourceRef.kind)}: ${sourceRef.label}`,
                  )
                  .join("; ")}
              </Caption>
            </div>
          ))}
        </div>
      </ResultCard>
    );
  },
});
