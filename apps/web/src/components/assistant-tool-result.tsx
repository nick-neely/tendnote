import {
  ArrowUpRightIcon,
  BookOpenIcon,
  CalendarClockIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  ListTodoIcon,
  MessageSquareTextIcon,
  NotebookPenIcon,
  RepeatIcon,
  SearchIcon,
  UserIcon,
  UserPenIcon,
  UserPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { AgendaCalendar } from "@/components/agenda-calendar";
import { Body, Caption, ResultCard } from "@/components/assistant-result-card";
import { labelSensitivity } from "@/lib/eve/agenda-format";
import { formatLinkedPeople, joinGeneralActionMeta } from "@/lib/eve/general-action-meta";
import { formatFieldList, PERSON_FIELD_LABEL } from "@/lib/eve/person-fields";
import {
  type AssistantToolView,
  type GeneralActionListItemView,
  type RelationshipContextSearchResultView,
  type SemanticContextSearchResultView,
  toolViewTier,
} from "@/lib/eve/tool-result-view";
import { cn } from "@/lib/utils";

/**
 * Renders one persisted Eve tool result at a visual weight that tracks how much
 * the user needs to notice it (see {@link toolViewTier}):
 *
 * - **line** — ambient lookups (a search, a recall) recede to a quiet inline
 *   row with no card chrome, so a turn's housekeeping reads like a margin note.
 * - **card** — durable, trust-bearing state changes (saved memory, added
 *   person, logged note, tentative suggestion) keep the Field Notebook card and
 *   its trust-weighted treatment. Tentative and logged context are never shown
 *   with the confirmed-fact treatment (ADR 0004, ADR 0029).
 * - **disclosure** — a result set collapses behind a one-line summary the user
 *   can expand on demand.
 */
export function AssistantToolResult({
  view,
  isNew = false,
}: {
  view: AssistantToolView;
  isNew?: boolean;
}) {
  switch (toolViewTier(view)) {
    case "line":
      return <LineView isNew={isNew} view={view} />;
    case "disclosure":
      return <DisclosureView isNew={isNew} view={view} />;
    default:
      return <CardView isNew={isNew} view={view} />;
  }
}

/**
 * Per-kind line renderers for the ambient tier. Keyed by `view.kind` so the
 * dispatcher stays a flat table lookup; a kind absent from the table has no line
 * treatment (the card/disclosure tiers own it) and renders nothing. The mapped
 * type hands each renderer its exact narrowed variant.
 */
const lineViewRenderers: {
  [K in AssistantToolView["kind"]]?: (
    view: Extract<AssistantToolView, { kind: K }>,
    isNew: boolean,
  ) => React.ReactNode;
} = {
  person_context: (view, isNew) => (
    <ToolActivityLine icon={<BookOpenIcon aria-hidden className="size-3.5" />} isNew={isNew}>
      Recalled {view.personName ?? "this person"}
      <span className="text-muted-foreground/80"> · {summarizeTiers(view)}</span>
      <span className="ml-1.5 font-mono text-[length:var(--text-caption)] text-muted-foreground/70">
        snapshot {view.snapshotStatus}
      </span>
    </ToolActivityLine>
  ),
  relationship_context_search: (_view, isNew) => (
    <ToolActivityLine icon={<SearchIcon aria-hidden className="size-3.5" />} isNew={isNew}>
      No matching relationship context found
    </ToolActivityLine>
  ),
  semantic_context_search: (_view, isNew) => (
    <ToolActivityLine icon={<SearchIcon aria-hidden className="size-3.5" />} isNew={isNew}>
      No semantic matches found
    </ToolActivityLine>
  ),
  relationship_agenda: (_view, isNew) => (
    <ToolActivityLine icon={<CalendarClockIcon aria-hidden className="size-3.5" />} isNew={isNew}>
      Nothing on the relationship agenda for that window
    </ToolActivityLine>
  ),
  memory_curator_proposals: (_view, isNew) => (
    <ToolActivityLine icon={<ClipboardListIcon aria-hidden className="size-3.5" />} isNew={isNew}>
      No memory cleanup proposals found
    </ToolActivityLine>
  ),
  draft_proposal: (view, isNew) => (
    <ToolActivityLine
      icon={<MessageSquareTextIcon aria-hidden className="size-3.5" />}
      isNew={isNew}
    >
      {labelDraftProposalSkip(view.skippedReason)}
    </ToolActivityLine>
  ),
  general_action_list: (view, isNew) => (
    <ToolActivityLine icon={<ListTodoIcon aria-hidden className="size-3.5" />} isNew={isNew}>
      {labelEmptyGeneralActionList(view.ledger)}
    </ToolActivityLine>
  ),
  // generic — an unrecognized tool ran to completion; name it and move on.
  generic: (view, isNew) => (
    <ToolActivityLine
      icon={<span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/50" />}
      isNew={isNew}
    >
      {humanizeToolName(view.toolName)}
    </ToolActivityLine>
  ),
};

/** Quiet ambient row: an Eve lookup that happened, kept out of the way. */
function LineView({ view, isNew }: { view: AssistantToolView; isNew: boolean }) {
  const render = lineViewRenderers[view.kind] as
    | ((view: AssistantToolView, isNew: boolean) => React.ReactNode)
    | undefined;
  return render ? render(view, isNew) : null;
}

/**
 * The collapsible `<details>` chrome shared by every disclosure tier: the border,
 * the summary row (icon + one-line count + chevron), and the expanded body. Each
 * per-kind renderer supplies only the icon, summary text, and body, so the shell
 * markup lives in exactly one place.
 */
function DisclosureShell({
  icon,
  summary,
  toolView,
  isNew,
  children,
}: {
  icon: React.ReactNode;
  summary: React.ReactNode;
  toolView: string;
  isNew: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className={cn(
        "group rounded-lg border bg-card [&[open]_.tn-chevron]:rotate-180",
        isNew && "fade-in slide-in-from-bottom-1 animate-in duration-200 ease-(--motion-ease-out)",
      )}
      data-tool-view={toolView}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg p-3.5 text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {icon}
        <span>{summary}</span>
        <ChevronDownIcon
          aria-hidden
          className="tn-chevron ml-auto size-3.5 shrink-0 transition-transform duration-200 ease-(--motion-ease-out)"
        />
      </summary>
      {children}
    </details>
  );
}

/** Summary phrasing for a search disclosure, factored out of its renderer. */
function searchDisclosureSummary(count: number, isSemantic: boolean): string {
  const noun = isSemantic ? "semantic match" : "exact match";
  return count === 1
    ? `Found 1 ${noun}`
    : `Found ${count} ${isSemantic ? "semantic matches" : "exact matches"}`;
}

/** Shared renderer for the two search disclosures (relationship + semantic). */
function renderSearchDisclosure(
  view: Extract<
    AssistantToolView,
    { kind: "relationship_context_search" | "semantic_context_search" }
  >,
  isNew: boolean,
): React.ReactNode {
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

/**
 * Per-kind disclosure renderers. Keyed by `view.kind`; a kind absent from the
 * table has no disclosure treatment and renders nothing.
 */
const disclosureViewRenderers: {
  [K in AssistantToolView["kind"]]?: (
    view: Extract<AssistantToolView, { kind: K }>,
    isNew: boolean,
  ) => React.ReactNode;
} = {
  relationship_agenda: (view, isNew) => {
    const count = view.candidates.length;
    return (
      <DisclosureShell
        icon={<CalendarClockIcon aria-hidden className="size-3.5 shrink-0" />}
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
  general_action_list: (view, isNew) => {
    const count = view.actions.length;
    return (
      <DisclosureShell
        icon={<ListTodoIcon aria-hidden className="size-3.5 shrink-0" />}
        isNew={isNew}
        summary={count === 1 ? "1 action" : `${count} actions`}
        toolView={view.kind}
      >
        <div className="flex flex-col divide-y divide-border/70 border-t px-3.5 pt-3 pb-3.5">
          {view.actions.map((action) => (
            <GeneralActionRow action={action} key={action.generalActionId} />
          ))}
        </div>
      </DisclosureShell>
    );
  },
  relationship_context_search: renderSearchDisclosure,
  semantic_context_search: renderSearchDisclosure,
};

/** Collapsible summary for a non-empty result set; expands to the full list. */
function DisclosureView({ view, isNew }: { view: AssistantToolView; isNew: boolean }) {
  const render = disclosureViewRenderers[view.kind] as
    | ((view: AssistantToolView, isNew: boolean) => React.ReactNode)
    | undefined;
  return render ? render(view, isNew) : null;
}

/**
 * Per-kind card renderers for durable, trust-bearing results. Keyed by
 * `view.kind`; a kind absent from the table earns no card here — notably
 * `message_draft` (the interactive ChatDraftCard's inline WYSIWYG edit + copy)
 * and `suggested_memory_review` (the interactive ChatReviewCard), both routed at
 * the panel level so this presentational module stays free of the client editor
 * and the `server-only` actions those cards need.
 */
const cardViewRenderers: {
  [K in AssistantToolView["kind"]]?: (
    view: Extract<AssistantToolView, { kind: K }>,
    isNew: boolean,
  ) => React.ReactNode;
} = {
  saved_memory: (view, isNew) => (
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
  added_person: (view, isNew) => (
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
  updated_person: (view, isNew) => {
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
  saved_source_record: (view, isNew) => (
    <ResultCard
      footer={<Caption>Logged context — saved for review, not a confirmed fact</Caption>}
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
  created_general_action: (view, isNew) => {
    const summary = summarizeGeneralAction(view);
    return (
      <ResultCard
        footer={
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {summary ? <Caption>{summary}</Caption> : <span />}
            {/* Deep-link the exact new row so the ledger scroll-and-pulse fires, instead
                of dropping the user at the top of the list (useDeepLinkHighlight). */}
            <Link
              className="inline-flex items-center gap-0.5 text-[length:var(--text-caption)] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              href={`/actions#action-${view.generalActionId}`}
            >
              Open in Actions
              <ArrowUpRightIcon aria-hidden className="size-3" />
            </Link>
          </div>
        }
        icon={
          view.isRoutine ? <RepeatIcon className="size-3" /> : <ListTodoIcon className="size-3" />
        }
        isNew={isNew}
        kind={view.kind}
        label={view.isRoutine ? "Added a routine" : "Added to your actions"}
        tone="confirmed"
      >
        <Body>{view.title}</Body>
      </ResultCard>
    );
  },
  memory_curator_proposals: (view, isNew) => {
    const count = view.proposals.length;
    return (
      <ResultCard
        footer={<Caption>Review-only cleanup proposals · no memories changed</Caption>}
        icon={<ClipboardListIcon className="size-3" />}
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
  // A skipped draft proposal (no `proposal`) has no card — its skip reason surfaces
  // on the ambient line tier instead — so this renders nothing in that case.
  draft_proposal: (view, isNew) =>
    view.proposal ? (
      <ResultCard
        footer={<Caption>Draft Proposal only · not saved as a Tendnote draft</Caption>}
        icon={<MessageSquareTextIcon className="size-3" />}
        isNew={isNew}
        kind={view.kind}
        label={`Draft options for ${view.proposal.personDisplayName}`}
        tone="neutral"
      >
        <div className="flex flex-col gap-3">
          {view.proposal.variants.map((variant) => (
            <div className="flex flex-col gap-1.5" key={variant.id}>
              <Caption>{variant.label}</Caption>
              <Body>{variant.body}</Body>
            </div>
          ))}
          <Caption>
            Grounded in{" "}
            {view.proposal.sourceRefs
              .map((sourceRef) => `${labelDraftSourceKind(sourceRef.kind)}: ${sourceRef.label}`)
              .join("; ")}
          </Caption>
        </div>
      </ResultCard>
    ) : null,
};

/** Durable, trust-bearing result that earns the Field Notebook card. */
function CardView({ view, isNew }: { view: AssistantToolView; isNew: boolean }) {
  const render = cardViewRenderers[view.kind] as
    | ((view: AssistantToolView, isNew: boolean) => React.ReactNode)
    | undefined;
  return render ? render(view, isNew) : null;
}

/** Quiet ambient line shared by completed lookups (the line tier). */
function ToolActivityLine({
  icon,
  children,
  isNew,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  isNew: boolean;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]",
        isNew && "fade-in animate-in duration-200 ease-(--motion-ease-out)",
      )}
    >
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

type SearchResultView = RelationshipContextSearchResultView | SemanticContextSearchResultView;

function SearchResultRow({
  result,
  mode,
}: {
  result: SearchResultView;
  mode: "exact" | "semantic";
}) {
  const href = result.relatedPersonId ? `/people/${result.relatedPersonId}` : null;
  const label =
    "label" in result
      ? result.label
      : (result.relatedPersonDisplayName ?? labelRecordKind(result.recordKind));
  const title = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {"recordKind" in result && result.recordKind === "person" ? (
        <UserIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <NotebookPenIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      )}
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

/** The quiet empty-state line for a ledger read that came back with nothing. */
function labelEmptyGeneralActionList(ledger: string): string {
  switch (ledger) {
    case "paused":
      return "No paused routines";
    case "resolved":
      return "Nothing finished recently";
    default:
      return "Nothing on your active list";
  }
}

/** Humanized status word for a ledger row's chip (the store's raw enum stays hidden). */
function labelGeneralActionStatus(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "deferred":
      return "Set aside";
    case "completed":
      return "Done";
    case "dismissed":
      return "Dismissed";
    case "archived":
      return "Archived";
    case "paused":
      return "Paused";
    case "suggested":
      return "Suggested";
    case "ignored":
      return "Ignored";
    default:
      return status;
  }
}

/**
 * The calm caption under a created action or a ledger row: cadence, timing, linked
 * people, and visibility, joined with dots and any empty part dropped — so an
 * unscheduled, personless action reads as a clean title with no dangling separators.
 * Shares the people/join formatting with the review card (see general-action-meta).
 */
function summarizeGeneralAction(
  action: Pick<
    GeneralActionListItemView,
    "isRoutine" | "recurrenceLabel" | "timingLabel" | "personNames" | "visibilityLabel"
  >,
): string | null {
  return joinGeneralActionMeta([
    action.isRoutine ? (action.recurrenceLabel ?? "Routine") : action.timingLabel,
    formatLinkedPeople(action.personNames),
    action.visibilityLabel,
  ]);
}

/** One General Action in a ledger list: title, a status chip, and a calm summary line. */
function GeneralActionRow({ action }: { action: GeneralActionListItemView }) {
  const summary = summarizeGeneralAction(action);
  return (
    <div className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {action.isRoutine ? (
            <RepeatIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ListTodoIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium text-foreground">{action.title}</span>
        </span>
        <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[length:var(--text-caption)] text-muted-foreground">
          {labelGeneralActionStatus(action.status)}
        </span>
      </div>
      {summary ? <Caption>{summary}</Caption> : null}
    </div>
  );
}

function summarizeTiers(view: Extract<AssistantToolView, { kind: "person_context" }>): string {
  const parts: string[] = [];
  if (view.approvedCount > 0) parts.push(`${view.approvedCount} confirmed`);
  if (view.loggedCount > 0) parts.push(`${view.loggedCount} logged`);
  if (view.suggestedCount > 0) parts.push(`${view.suggestedCount} to review`);

  return parts.length > 0 ? parts.join(" · ") : "Nothing recorded yet";
}

function labelRecordKind(kind: SearchResultView["recordKind"]) {
  if (kind === "source_record") return "Source record";
  return kind === "memory" ? "Memory" : "Person";
}

function labelMemoryCuratorSourceKind(kind: "memory" | "source_record") {
  return kind === "memory" ? "Memory" : "Source record";
}

function labelDraftSourceKind(
  kind: NonNullable<
    Extract<AssistantToolView, { kind: "draft_proposal" }>["proposal"]
  >["sourceRefs"][number]["kind"],
) {
  switch (kind) {
    case "approved_memory":
      return "Memory";
    case "source_record":
      return "Source record";
    case "suggested_memory":
      return "Suggested memory";
    case "followup":
      return "Follow-up";
    case "brief_item":
      return "Brief item";
  }
}

function labelDraftProposalSkip(
  reason: Extract<AssistantToolView, { kind: "draft_proposal" }>["skippedReason"],
) {
  switch (reason) {
    case "person_not_found":
      return "No draft options: person could not be resolved";
    case "generation_failed":
      return "No draft options: drafting is temporarily unavailable";
    default:
      return "No draft options: not enough grounded context";
  }
}

function labelTrust(result: SearchResultView) {
  const trust =
    result.trustLevel === "confirmed_fact"
      ? "Confirmed fact"
      : result.trustLevel === "logged_context"
        ? "Logged context"
        : "Identity reference";

  return result.relatedPersonDisplayName ? `${trust} · ${result.relatedPersonDisplayName}` : trust;
}

function humanizeToolName(toolName: string): string {
  return toolName.replace(/_/g, " ");
}
