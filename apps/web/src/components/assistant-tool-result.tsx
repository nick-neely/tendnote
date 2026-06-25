import { BookOpenIcon, CheckIcon, NotebookPenIcon, UserPlusIcon } from "lucide-react";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";
import { cn } from "@/lib/utils";

/**
 * Renders one persisted Eve tool result as a calm Field Notebook card. The
 * visual weight tracks trust: sage confirmation for saved memories and added
 * people, a quiet neutral note for logged context, and the clay review capsule
 * for tentative suggestions. Tentative and logged context are never shown with
 * the confirmed-fact treatment (ADR 0004, ADR 0029).
 */
export function AssistantToolResult({
  view,
  isNew = false,
}: {
  view: AssistantToolView;
  isNew?: boolean;
}) {
  if (view.kind === "generic") {
    return (
      <Shell isNew={isNew} kind={view.kind}>
        <StatusRow
          icon={<span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/60" />}
          label="Done"
        />
        <Caption>{humanizeToolName(view.toolName)}</Caption>
      </Shell>
    );
  }

  if (view.kind === "saved_memory") {
    return (
      <Shell isNew={isNew} kind={view.kind}>
        <StatusRow
          icon={<CheckIcon aria-hidden className="size-3.5 text-primary" />}
          label="Saved to memory"
        />
        <Body>{view.content}</Body>
        <Caption>
          Confirmed fact{view.personName ? ` · ${view.personName}` : ""}
          {view.sourceRecordId ? " · grounded in a source record" : ""}
        </Caption>
      </Shell>
    );
  }

  if (view.kind === "saved_source_record") {
    return (
      <Shell isNew={isNew} kind={view.kind}>
        <StatusRow
          icon={<NotebookPenIcon aria-hidden className="size-3.5 text-muted-foreground" />}
          label="Logged"
        />
        <Body>
          <span className="text-muted-foreground">You noted: </span>
          {view.content}
        </Body>
        <Caption>Logged context — saved for review, not a confirmed fact</Caption>
      </Shell>
    );
  }

  if (view.kind === "added_person") {
    return (
      <Shell isNew={isNew} kind={view.kind}>
        <StatusRow
          icon={<UserPlusIcon aria-hidden className="size-3.5 text-primary" />}
          label="Added to your notebook"
        />
        <Body>{view.displayName}</Body>
        {view.relationshipType ? <Caption>{view.relationshipType}</Caption> : null}
      </Shell>
    );
  }

  if (view.kind === "person_context") {
    return (
      <Shell isNew={isNew} kind={view.kind}>
        <StatusRow
          icon={<BookOpenIcon aria-hidden className="size-3.5 text-muted-foreground" />}
          label={`Recalled ${view.personName ?? "this person"}`}
        />
        <Caption>{summarizeTiers(view)}</Caption>
        <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
          snapshot {view.snapshotStatus}
        </span>
      </Shell>
    );
  }

  // suggested_memory_review — tentative, never asserted as fact.
  return (
    <Shell isNew={isNew} kind={view.kind}>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-accent" />
        Ready to review
      </span>
      <Body>
        <span className="text-muted-foreground">Suggested: </span>
        {view.content}
      </Body>
      <Caption>Tentative — not saved until you approve it</Caption>
    </Shell>
  );
}

function Shell({
  children,
  isNew,
  kind,
}: {
  children: React.ReactNode;
  isNew: boolean;
  kind: AssistantToolView["kind"];
}) {
  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-3.5",
        isNew && "fade-in slide-in-from-bottom-1 animate-in duration-200 ease-(--motion-ease-out)",
      )}
      data-tool-view={kind}
    >
      {children}
    </article>
  );
}

function StatusRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[length:var(--text-small)] text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[68ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
      {children}
    </p>
  );
}

/** Sans explanatory caption — copy, not machine facts, so never mono (DESIGN.md §4). */
function Caption({ children }: { children: React.ReactNode }) {
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

function humanizeToolName(toolName: string): string {
  return toolName.replace(/_/g, " ");
}
