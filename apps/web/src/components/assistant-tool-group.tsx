import { CheckIcon, NotebookPenIcon, UserPenIcon, UserPlusIcon } from "lucide-react";
import { Body, CARD_TONE, Caption, type CardTone } from "@/components/assistant-result-card";
import {
  assistantToolViewKey,
  type GroupableToolKind,
  type GroupableToolView,
} from "@/components/assistant-results/registry";
import { DisclosureShell } from "@/components/assistant-results/shells";
import { formatFieldList, PERSON_FIELD_LABEL } from "@/lib/eve/person-fields";
import { cn } from "@/lib/utils";

/**
 * Per-kind chrome for a collapsed group of durable records. Tone tracks trust the
 * same way single cards do (sage = confirmed, neutral = logged), so a glance at
 * the summary reads how much to trust the batch before it is expanded. Labels are
 * always plural — a group only exists for two or more records.
 */
const GROUP_META: Record<
  GroupableToolKind,
  { tone: CardTone; icon: React.ReactNode; label: (count: number) => string }
> = {
  saved_memory: {
    tone: "confirmed",
    icon: <CheckIcon className="size-3" />,
    label: (count) => `Saved ${count} memories`,
  },
  saved_source_record: {
    tone: "neutral",
    icon: <NotebookPenIcon className="size-3" />,
    label: (count) => `Logged ${count} notes`,
  },
  added_person: {
    tone: "confirmed",
    icon: <UserPlusIcon className="size-3" />,
    label: (count) => `Added ${count} people`,
  },
  updated_person: {
    tone: "confirmed",
    icon: <UserPenIcon className="size-3" />,
    label: (count) => `Updated ${count} profiles`,
  },
};

/**
 * Collapsed, trust-weighted summary for several same-kind durable records from one
 * turn (see {@link groupTurnToolEntries} in message-views). It keeps the Field
 * Notebook card's tone but defaults to a single summary line — "Saved 6 memories ·
 * Mara" — so a busy capture turn stays quiet; expanding reveals each record as a
 * compact Personal Ledger row (thin rules, content first), never a nested card.
 * Read-only by design: only tentative suggestions earn inline actions, and those
 * are routed to their own interactive cards, never grouped.
 */
export function AssistantToolGroup({
  kind,
  views,
  isNew = false,
}: {
  kind: GroupableToolKind;
  views: readonly GroupableToolView[];
  isNew?: boolean;
}) {
  const meta = GROUP_META[kind];
  const t = CARD_TONE[meta.tone];
  const shared = sharedPersonName(views);

  return (
    <DisclosureShell
      footer={<Caption>{groupFooter(kind, views)}</Caption>}
      icon={
        <span
          aria-hidden
          className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", t.chip)}
        >
          {meta.icon}
        </span>
      }
      isNew={isNew}
      size="lg"
      summary={
        <span className={cn("min-w-0 text-[length:var(--text-small)] font-medium", t.label)}>
          {meta.label(views.length)}
          {shared ? <span className="font-normal text-muted-foreground"> · {shared}</span> : null}
        </span>
      }
      tone={meta.tone}
      toolView={`${kind}_group`}
    >
      <div className={cn("flex flex-col divide-y border-t px-3 pt-2 pb-3", t.divider)}>
        {views.map((view) => (
          <GroupRow key={assistantToolViewKey(view)} showPerson={!shared} view={view} />
        ))}
      </div>
    </DisclosureShell>
  );
}

/** One compact ledger row inside a group: the record's content, person second. */
function GroupRow({ view, showPerson }: { view: GroupableToolView; showPerson: boolean }) {
  if (view.kind === "saved_memory") {
    return (
      <div className="py-2 first:pt-0 last:pb-0">
        <Body>
          {showPerson && view.personName ? (
            <span className="text-muted-foreground">{view.personName}: </span>
          ) : null}
          {view.content}
        </Body>
      </div>
    );
  }

  if (view.kind === "saved_source_record") {
    return (
      <div className="py-2 first:pt-0 last:pb-0">
        <Body>
          <span className="text-muted-foreground">You noted: </span>
          {view.content}
        </Body>
      </div>
    );
  }

  // added_person / updated_person — the person is the record, so the name leads
  // and the change rides beneath it as a quiet caption.
  const detail =
    view.kind === "added_person"
      ? view.relationshipType
      : view.updatedFields.length > 0
        ? `Updated ${formatFieldList(view.updatedFields.map((field) => PERSON_FIELD_LABEL[field] ?? field))}`
        : null;

  return (
    <div className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
      <p className="text-[length:var(--text-body)] font-medium leading-[var(--text-body-line)]">
        {view.displayName}
      </p>
      {detail ? <Caption>{detail}</Caption> : null}
    </div>
  );
}

/** The person name when every record in a group shares one; otherwise null. */
function sharedPersonName(views: readonly GroupableToolView[]): string | null {
  let name: string | null = null;
  for (const view of views) {
    const personName = view.kind === "saved_memory" ? view.personName : null;
    if (!personName) return null;
    if (name === null) {
      name = personName;
    } else if (name !== personName) {
      return null;
    }
  }
  return name;
}

/** Trust language for a group's footer, mirroring the single-card captions. */
function groupFooter(kind: GroupableToolKind, views: readonly GroupableToolView[]): string {
  switch (kind) {
    case "saved_memory": {
      const grounded = views.some((view) => view.kind === "saved_memory" && view.sourceRecordId);
      return `Confirmed facts${grounded ? " · grounded in source records" : ""}`;
    }
    case "saved_source_record":
      return "Logged context, saved for review. Not confirmed facts.";
    case "added_person":
      return "Added to your notebook";
    case "updated_person":
      return "Updated in your notebook";
  }
}
