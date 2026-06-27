import {
  BookOpenIcon,
  CalendarClockIcon,
  CheckIcon,
  ChevronDownIcon,
  NotebookPenIcon,
  SearchIcon,
  UserIcon,
  UserPenIcon,
  UserPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { AgendaCalendar } from "@/components/agenda-calendar";
import { labelSensitivity } from "@/lib/eve/agenda-format";
import {
  type AssistantToolView,
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

/** Quiet ambient row: an Eve lookup that happened, kept out of the way. */
function LineView({ view, isNew }: { view: AssistantToolView; isNew: boolean }) {
  if (view.kind === "person_context") {
    return (
      <ToolActivityLine icon={<BookOpenIcon aria-hidden className="size-3.5" />} isNew={isNew}>
        Recalled {view.personName ?? "this person"}
        <span className="text-muted-foreground/80"> · {summarizeTiers(view)}</span>
        <span className="ml-1.5 font-mono text-[length:var(--text-caption)] text-muted-foreground/70">
          snapshot {view.snapshotStatus}
        </span>
      </ToolActivityLine>
    );
  }

  if (view.kind === "relationship_context_search") {
    return (
      <ToolActivityLine icon={<SearchIcon aria-hidden className="size-3.5" />} isNew={isNew}>
        No matching relationship context found
      </ToolActivityLine>
    );
  }

  if (view.kind === "semantic_context_search") {
    return (
      <ToolActivityLine icon={<SearchIcon aria-hidden className="size-3.5" />} isNew={isNew}>
        No semantic matches found
      </ToolActivityLine>
    );
  }

  if (view.kind === "relationship_agenda") {
    return (
      <ToolActivityLine icon={<CalendarClockIcon aria-hidden className="size-3.5" />} isNew={isNew}>
        Nothing on the relationship agenda for that window
      </ToolActivityLine>
    );
  }

  // generic — an unrecognized tool ran to completion; name it and move on.
  if (view.kind === "generic") {
    return (
      <ToolActivityLine
        icon={<span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/50" />}
        isNew={isNew}
      >
        {humanizeToolName(view.toolName)}
      </ToolActivityLine>
    );
  }

  return null;
}

/** Collapsible summary for a non-empty result set; expands to the full list. */
function DisclosureView({ view, isNew }: { view: AssistantToolView; isNew: boolean }) {
  if (view.kind === "relationship_agenda") {
    const count = view.candidates.length;

    return (
      <details
        className={cn(
          "group rounded-lg border bg-card [&[open]_.tn-chevron]:rotate-180",
          isNew &&
            "fade-in slide-in-from-bottom-1 animate-in duration-200 ease-(--motion-ease-out)",
        )}
        data-tool-view={view.kind}
      >
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg p-3.5 text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <CalendarClockIcon aria-hidden className="size-3.5 shrink-0" />
          <span>{count === 1 ? "Found 1 agenda item" : `Found ${count} agenda items`}</span>
          <ChevronDownIcon
            aria-hidden
            className="tn-chevron ml-auto size-3.5 shrink-0 transition-transform duration-200 ease-(--motion-ease-out)"
          />
        </summary>
        <div className="border-t">
          <AgendaCalendar candidates={view.candidates} window={view.window ?? null} />
        </div>
      </details>
    );
  }

  if (view.kind !== "relationship_context_search" && view.kind !== "semantic_context_search") {
    return null;
  }

  const count = view.results.length;
  const isSemantic = view.kind === "semantic_context_search";

  return (
    <details
      className={cn(
        "group rounded-lg border bg-card [&[open]_.tn-chevron]:rotate-180",
        isNew && "fade-in slide-in-from-bottom-1 animate-in duration-200 ease-(--motion-ease-out)",
      )}
      data-tool-view={view.kind}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg p-3.5 text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <SearchIcon aria-hidden className="size-3.5 shrink-0" />
        <span>
          {count === 1
            ? `Found 1 ${isSemantic ? "semantic match" : "exact match"}`
            : `Found ${count} ${isSemantic ? "semantic matches" : "exact matches"}`}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="tn-chevron ml-auto size-3.5 shrink-0 transition-transform duration-200 ease-(--motion-ease-out)"
        />
      </summary>
      <div className="flex flex-col divide-y divide-border/70 border-t px-3.5 pt-3 pb-3.5">
        {view.results.map((result) => (
          <SearchResultRow
            key={`${result.recordKind}:${result.recordId}`}
            mode={isSemantic ? "semantic" : "exact"}
            result={result}
          />
        ))}
      </div>
    </details>
  );
}

/** Durable, trust-bearing result that earns the Field Notebook card. */
function CardView({ view, isNew }: { view: AssistantToolView; isNew: boolean }) {
  if (view.kind === "saved_memory") {
    return (
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
    );
  }

  if (view.kind === "added_person") {
    return (
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
    );
  }

  if (view.kind === "updated_person") {
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
  }

  if (view.kind === "saved_source_record") {
    return (
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
    );
  }

  // suggested_memory_review is rendered by the interactive ChatReviewCard, routed
  // at the panel level so this presentational module stays free of the server
  // actions (and their `server-only` import) the inline approve/dismiss needs.
  return null;
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
        {labelTrust(result)}
        {mode === "semantic" ? ` · ${labelSensitivity(result.sensitivity)}` : ""}
      </Caption>
    </div>
  );
}

export type CardTone = "confirmed" | "neutral" | "tentative";

/**
 * Trust-weighted surface for a tool-result card. Confirmed saves carry a quiet
 * sage wash (sage = confirmed in the system), logged context stays neutral, and
 * tentative suggestions take a clay wash — so the card's color says how much to
 * trust it before a word is read (DESIGN.md §3, ADR 0004, ADR 0029).
 */
const CARD_TONE: Record<
  CardTone,
  { surface: string; divider: string; chip: string; label: string }
> = {
  confirmed: {
    surface: "border-primary/20 bg-primary/[0.05]",
    divider: "border-primary/15",
    chip: "bg-primary/15 text-primary",
    label: "text-primary",
  },
  neutral: {
    surface: "border-border bg-card",
    divider: "border-border",
    chip: "bg-secondary text-muted-foreground",
    label: "text-foreground",
  },
  tentative: {
    surface: "border-accent/25 bg-accent-soft/45",
    divider: "border-accent/20",
    chip: "bg-accent/15 text-accent",
    label: "text-accent-soft-foreground",
  },
};

export function ResultCard({
  tone,
  icon,
  label,
  footer,
  children,
  isNew,
  kind,
}: {
  tone: CardTone;
  icon?: React.ReactNode;
  label?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  isNew: boolean;
  kind: AssistantToolView["kind"];
}) {
  const t = CARD_TONE[tone];

  return (
    <article
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border p-3.5",
        t.surface,
        isNew && "fade-in slide-in-from-bottom-1 animate-in duration-200 ease-(--motion-ease-out)",
      )}
      data-tool-view={kind}
    >
      {icon && label ? (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", t.chip)}
          >
            {icon}
          </span>
          <span className={cn("text-[length:var(--text-small)] font-medium", t.label)}>
            {label}
          </span>
        </div>
      ) : null}
      {children}
      {footer ? <div className={cn("border-t pt-2.5", t.divider)}>{footer}</div> : null}
    </article>
  );
}

export function Body({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[68ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
      {children}
    </p>
  );
}

/** Sans explanatory caption — copy, not machine facts, so never mono (DESIGN.md §4). */
export function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[length:var(--text-caption)] text-muted-foreground">{children}</span>
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

function labelTrust(result: SearchResultView) {
  const trust =
    result.trustLevel === "confirmed_fact"
      ? "Confirmed fact"
      : result.trustLevel === "logged_context"
        ? "Logged context"
        : "Identity reference";

  return result.relatedPersonDisplayName ? `${trust} · ${result.relatedPersonDisplayName}` : trust;
}

/** Human labels for the profile fields `update_person` can change. */
const PERSON_FIELD_LABEL: Record<string, string> = {
  displayName: "name",
  firstName: "first name",
  lastName: "last name",
  birthday: "birthday",
  relationshipType: "relationship",
  closenessLevel: "closeness",
  profileBlurb: "description",
};

const fieldListFormatter = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

function formatFieldList(fields: string[]): string {
  return fieldListFormatter.format(fields);
}

function humanizeToolName(toolName: string): string {
  return toolName.replace(/_/g, " ");
}
