"use client";

import type { SavedItemKind } from "@tendnote/domain";
import type { VisibilityChoice } from "@tendnote/domain/privacy";
import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import {
  archiveSavedItemAction,
  createSavedItemAction,
  deleteUniqueSavedItemSourceAction,
  getArchivedSavedItemViewsAction,
  getSavedItemSourceDeletionImpactAction,
  promoteSavedItemToGeneralActionAction,
  reopenSavedItemAction,
  resolveSavedItemAction,
} from "@/app/actions/saved-items";
import { GeneralActionReminderField } from "@/components/general-action-reminder";
import { ActionScopeChip, ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import {
  ActionVisibilityField,
  AudiencePreview,
  type ShareableActionMember,
} from "@/components/general-action-visibility-field";
import {
  ArchiveIcon,
  BellIcon,
  BookmarkIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  LinkIcon,
  ListPlusIcon,
  RotateCcwIcon,
} from "@/components/icons";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { RecordTimingChip } from "@/components/record-timing-chip";
import { ReminderPastLeadRecovery } from "@/components/reminder-past-lead-recovery";
import { SavedItemEditForm } from "@/components/saved-item-edit-form";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DateTimePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { captureFocusAfterRemoval } from "@/lib/focus-after-removal";
import {
  type ReversibleMutationApplyPhase,
  type ReversibleMutationApplyResult,
  ReversibleMutationProvider,
  useActiveReversibleMutation,
  usePendingMutationSubmit,
  useReversibleMutation,
} from "@/lib/reversible-mutation";
import { savedItemLifecycleAdapter } from "@/lib/saved-item-reversible-mutation";
import type { SavedItemView } from "@/lib/saved-item-view";
import { useReminderSchedule } from "@/lib/use-reminder-schedule";
import { useReminderScheduleWriter } from "@/lib/use-reminder-schedule-writer";
import { reconcileRevisionedItems, useServerSyncedList } from "@/lib/use-server-synced-list";

const KIND_OPTIONS: Array<{ value: SavedItemKind; label: string }> = [
  { value: "note", label: "Note" },
  { value: "link", label: "Link" },
  { value: "open_question", label: "Open question" },
];

const EMPTY_SAVED_ITEM_DRAFT = {
  kind: "note" as SavedItemKind,
  title: "",
  content: "",
  url: "",
  bringBackAt: "",
  showSharing: false,
  visibilityChoice: "only_me" as VisibilityChoice,
  selectedUserIds: [] as string[],
};

export function SavedItemsSurface({
  ...props
}: {
  items: SavedItemView[];
  shareableMembers?: ShareableActionMember[];
}) {
  return (
    <ReversibleMutationProvider>
      <SavedItemsSurfaceContent {...props} />
    </ReversibleMutationProvider>
  );
}

function SavedItemsSurfaceContent({
  items,
  shareableMembers = [],
}: {
  items: SavedItemView[];
  shareableMembers?: ShareableActionMember[];
}) {
  const acknowledgedRevisions = useRef(new Map<string, string>());
  const [list, setList] = useServerSyncedList(
    items,
    (item) => item.id,
    undefined,
    (item) => item.revision,
    (item) => {
      const acknowledged = acknowledgedRevisions.current.get(item.id);
      return !acknowledged || item.revision > acknowledged;
    },
  );
  const [state, setState] = useState<"active" | "archived">("active");
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [archivedLoading, startArchivedTransition] = useTransition();

  const visible = list.filter((item) => item.status === state);
  function upsert(item: SavedItemView, phase: ReversibleMutationApplyPhase = "authoritative") {
    const acknowledged = acknowledgedRevisions.current.get(item.id);
    if (phase === "authoritative") {
      if (acknowledged && item.revision <= acknowledged) return false;
      acknowledgedRevisions.current.set(item.id, item.revision);
    }
    setList((current) =>
      reconcileRevisionedItems(
        current,
        [item],
        (entry) => entry.id,
        (entry) => entry.revision,
      ),
    );
    return true;
  }
  function remove(savedItemId: string) {
    setList((current) => current.filter((entry) => entry.id !== savedItemId));
  }

  function selectState(nextState: "active" | "archived") {
    setState(nextState);
    if (nextState !== "archived" || archivedLoaded || archivedLoading) return;
    setArchivedError(null);
    startArchivedTransition(async () => {
      try {
        const archived = await getArchivedSavedItemViewsAction();
        setList((current) => [
          ...current.filter((item) => item.status !== "archived"),
          ...archived,
        ]);
        setArchivedLoaded(true);
      } catch {
        setArchivedError("Archived Saved Items couldn't be loaded. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <CreateSavedItemForm onCreate={upsert} shareableMembers={shareableMembers} />

      <fieldset className="flex items-center gap-1">
        <legend className="sr-only">Saved Item state</legend>
        {(["active", "archived"] as const).map((value) => (
          <Button
            aria-pressed={state === value}
            key={value}
            onClick={() => selectState(value)}
            size="sm"
            variant={state === value ? "secondary" : "ghost"}
          >
            {value === "active" ? "Active" : "Archived"}
          </Button>
        ))}
      </fieldset>

      {state === "archived" && archivedLoading ? (
        <LedgerEmpty>
          <span aria-busy="true" role="status">
            Loading archived Saved Items…
          </span>
        </LedgerEmpty>
      ) : visible.length ? (
        <LedgerList>
          {visible.map((item) => (
            <SavedItemRow item={item} key={item.id} onDelete={remove} onUpdate={upsert} />
          ))}
        </LedgerList>
      ) : state === "active" ? (
        <EmptyState
          description="Keep a note, a link, or an open question you want to come back to."
          title="Nothing saved here yet."
        />
      ) : (
        <EmptyState title="No archived Saved Items." />
      )}
      {state === "archived" && archivedError ? (
        <div className="flex items-center gap-2" role="status">
          <ErrorText message={archivedError} />
          <Button onClick={() => selectState("archived")} size="sm" type="button" variant="outline">
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CreateSavedItemForm({
  onCreate,
  shareableMembers,
}: {
  onCreate: (item: SavedItemView) => void;
  shareableMembers: ShareableActionMember[];
}) {
  const reminderWriter = useReminderScheduleWriter();
  const [draft, setDraft] = useState(EMPTY_SAVED_ITEM_DRAFT);
  const {
    choice: reminderChoice,
    enabled: reminderEnabled,
    reset: resetReminder,
    save: saveSchedule,
    setChoice: setReminderChoice,
    setEnabled: setReminderEnabled,
  } = useReminderSchedule();
  const { error, setError, pending, submit } = usePendingMutationSubmit(GENERIC_ERROR);
  const [pastLeadRecovery, setPastLeadRecovery] = useState<{
    label: string;
    recordId: string;
  } | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const { kind, title, content, url, bringBackAt, showSharing, visibilityChoice, selectedUserIds } =
    draft;
  const selectedMembersRequired =
    visibilityChoice === "selected_members" && selectedUserIds.length === 0;

  function reset() {
    setDraft(EMPTY_SAVED_ITEM_DRAFT);
    resetReminder();
    setError(null);
  }

  function updateDraft(patch: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  const actionInput = {
    kind,
    title: title.trim(),
    content: content.trim(),
    url: url.trim(),
    bringBackAt,
    visibilityChoice,
    selectedUserIds,
  };

  return (
    <div className="flex flex-col gap-2.5">
      <form
        className="flex flex-col gap-3 rounded-xl border bg-surface px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || selectedMembersRequired) return;
          submit(
            () => createSavedItemAction(compactCreateInput(actionInput)),
            async (item) => {
              let view = item;
              if (reminderEnabled && bringBackAt) {
                const reminder = await saveSchedule("saved_item", item.id);
                if (reminder.nextValidChoice) {
                  onCreate(item);
                  reset();
                  setPastLeadRecovery({
                    label: reminder.nextValidChoice.label,
                    recordId: item.id,
                  });
                  return;
                }
                view = {
                  ...item,
                  reminderSchedule: reminder.scheduleView,
                };
              }
              onCreate(view);
              reset();
            },
          );
        }}
      >
        <CreateSavedItemFields
          content={content}
          kind={kind}
          onContentChange={(value) => updateDraft({ content: value })}
          onKindChange={(value) => {
            updateDraft({ kind: value, ...(value === "link" ? {} : { url: "" }) });
          }}
          onTitleChange={(value) => updateDraft({ title: value })}
          onUrlChange={(value) => updateDraft({ url: value })}
          title={title}
          url={url}
        />
        <CreateSavedItemFooter
          bringBackAt={bringBackAt}
          disabled={pending || !title.trim() || selectedMembersRequired}
          onBringBackAtChange={(value) => updateDraft({ bringBackAt: value })}
          pending={pending}
        />
        {bringBackAt ? (
          <GeneralActionReminderField
            choice={reminderChoice}
            enabled={reminderEnabled}
            instantRelative
            onChoiceChange={setReminderChoice}
            onEnabledChange={setReminderEnabled}
          />
        ) : null}
        <CreateSavedItemSharing
          members={shareableMembers}
          onChoiceChange={(value) => updateDraft({ visibilityChoice: value })}
          onOpenChange={(open) => updateDraft({ showSharing: open })}
          onSelectedChange={(value) => updateDraft({ selectedUserIds: value })}
          selectedUserIds={selectedUserIds}
          show={showSharing}
          value={visibilityChoice}
        />

        {error ? <ErrorText message={error} /> : null}
      </form>
      {pastLeadRecovery ? (
        <ReminderPastLeadRecovery
          label={pastLeadRecovery.label}
          onRecover={async () => {
            setRecoveryPending(true);
            try {
              await reminderWriter.save("saved_item", pastLeadRecovery.recordId, {
                kind: "relative",
                leadMinutes: 0,
              });
              setPastLeadRecovery(null);
            } finally {
              setRecoveryPending(false);
            }
          }}
          pending={recoveryPending}
        />
      ) : null}
    </div>
  );
}

function compactCreateInput(input: {
  kind: SavedItemKind;
  title: string;
  content: string;
  url: string;
  bringBackAt: string;
  visibilityChoice: VisibilityChoice;
  selectedUserIds: string[];
}): Parameters<typeof createSavedItemAction>[0] {
  return {
    kind: input.kind,
    title: input.title,
    visibilityChoice: input.visibilityChoice,
    ...(input.content ? { content: input.content } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.bringBackAt ? { bringBackAt: input.bringBackAt } : {}),
    ...(input.selectedUserIds.length ? { selectedUserIds: input.selectedUserIds } : {}),
  };
}

function CreateSavedItemFields({
  content,
  kind,
  onContentChange,
  onKindChange,
  onTitleChange,
  onUrlChange,
  title,
  url,
}: {
  content: string;
  kind: SavedItemKind;
  onContentChange: (value: string) => void;
  onKindChange: (value: SavedItemKind) => void;
  onTitleChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  title: string;
  url: string;
}) {
  const kindId = useId();
  const titleId = useId();
  const urlId = useId();
  const contentId = useId();
  const isQuestion = kind === "open_question";
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={kindId}>
          Kind
          <Select onValueChange={(value) => onKindChange(value as SavedItemKind)} value={kind}>
            {/* `w-full` because the trigger is `w-fit` by default and this one owns a grid
                column beside a full-width Title field. */}
            <SelectTrigger className="w-full" id={kindId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={titleId}>
          Title
          <Input
            id={titleId}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder={isQuestion ? "What do you want to answer?" : "What do you want to keep?"}
            value={title}
          />
        </label>
      </div>
      {kind === "link" ? (
        <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={urlId}>
          Link URL
          <Input
            id={urlId}
            inputMode="url"
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="https://"
            type="url"
            value={url}
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={contentId}>
        {isQuestion ? "Context" : "Details"}
        <Textarea
          id={contentId}
          onChange={(event) => onContentChange(event.target.value)}
          placeholder="Optional"
          rows={2}
          value={content}
        />
      </label>
    </>
  );
}

function CreateSavedItemFooter({
  bringBackAt,
  disabled,
  onBringBackAtChange,
  pending,
}: {
  bringBackAt: string;
  disabled: boolean;
  onBringBackAtChange: (value: string) => void;
  pending: boolean;
}) {
  const bringBackAtId = useId();
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      {/* The label sits beside the picker rather than wrapping it: a wrapping label
          folds the time input's own name into the date trigger's. */}
      <div className="flex max-w-xs flex-1 flex-col gap-1.5">
        <label className="text-sm font-medium" htmlFor={bringBackAtId}>
          Bring back
        </label>
        <DateTimePicker id={bringBackAtId} onChange={onBringBackAtChange} value={bringBackAt} />
      </div>
      <Button disabled={disabled} type="submit">
        <BookmarkIcon aria-hidden />
        {pending ? "Saving…" : "Save item"}
      </Button>
    </div>
  );
}

function CreateSavedItemSharing({
  members,
  onChoiceChange,
  onOpenChange,
  onSelectedChange,
  selectedUserIds,
  show,
  value,
}: {
  members: ShareableActionMember[];
  onChoiceChange: (value: VisibilityChoice) => void;
  onOpenChange: (open: boolean) => void;
  onSelectedChange: (value: string[]) => void;
  selectedUserIds: string[];
  show: boolean;
  value: VisibilityChoice;
}) {
  if (!members.length) return null;
  return (
    // Collapsible owns the trigger/content wiring the hand-rolled `aria-expanded`
    // button did, so the panel id no longer needs a `useId` of its own.
    <Collapsible className="flex flex-col gap-3" onOpenChange={onOpenChange} open={show}>
      <CollapsibleTrigger className="self-start rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        Share with your household
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2">
        <ActionVisibilityField
          members={members}
          name="saved-item-visibility"
          onChoiceChange={onChoiceChange}
          onSelectedChange={onSelectedChange}
          selectedUserIds={selectedUserIds}
          value={value}
        />
        <AudiencePreview
          choice={value}
          householdSize={members.length + 1}
          selectedCount={selectedUserIds.length}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

function SavedItemRow({
  item,
  onDelete,
  onUpdate,
}: {
  item: SavedItemView;
  onDelete: (savedItemId: string) => void;
  onUpdate: (
    item: SavedItemView,
    phase?: ReversibleMutationApplyPhase,
  ) => ReversibleMutationApplyResult;
}) {
  const [editing, setEditing] = useState(false);
  const archive = useReversibleMutation(item.id, "archive");
  const reopen = useReversibleMutation(item.id, "reopen");
  const update = useReversibleMutation(item.id, "update");
  const active = useActiveReversibleMutation(item.id, ["archive", "reopen", "update"]);
  const pending = Boolean(active?.state.pending);

  function runPending(
    runMutation: () => ReturnType<typeof archiveSavedItemAction>,
    focusTarget: HTMLElement | null,
  ) {
    update.run({
      kind: "pending",
      apply: (view, phase) => {
        const accepted = onUpdate(view, phase);
        setEditing(false);
        return accepted;
      },
      command: runMutation,
      focusTarget,
      labels: {
        pending: "Updating Saved Item…",
        success: "Saved Item updated.",
        rollback: "The Saved Item was not changed.",
        undo: "",
        undone: "",
      },
    });
  }

  // fallow-ignore-next-line complexity -- Archive and reopen are one paired reversible lifecycle with mirrored labels and commands.
  function runLifecycle(intent: "archive" | "reopen", focusTarget: HTMLElement) {
    const mutation = intent === "archive" ? archive : reopen;
    const row = document.getElementById(`saved-item-${item.id}`);
    const moveFocus = captureFocusAfterRemoval(row);
    mutation.run({
      kind: "optimistic",
      adapter: savedItemLifecycleAdapter(intent),
      apply: onUpdate,
      command: () =>
        intent === "archive"
          ? archiveSavedItemAction({ savedItemId: item.id })
          : reopenSavedItemAction({ savedItemId: item.id }),
      focusTarget,
      labels: {
        pending: `${intent === "archive" ? "Archiving" : "Reopening"} Saved Item…`,
        success: `Saved Item ${intent === "archive" ? "archived" : "reopened"}. Undo available.`,
        rollback: `The Saved Item was restored after ${intent} failed.`,
        undo: `Undo ${intent === "archive" ? "Archive" : "Reopen"}`,
        undone: "Saved Item restored.",
      },
      leave: {
        apply: (view) => {
          const accepted = onUpdate(view, "authoritative");
          moveFocus();
          return accepted;
        },
      },
      prior: item,
    });
  }

  return (
    <article
      className="scroll-mt-20 flex flex-col gap-3 px-4 py-3.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      id={`saved-item-${item.id}`}
      tabIndex={-1}
    >
      <SavedItemSummary item={item} />
      <SavedItemOutcomes item={item} />
      <SourceGroundingDetails item={item} onDelete={onDelete} />

      {editing ? (
        <SavedItemEditForm
          item={item}
          onCancel={() => setEditing(false)}
          onSave={runPending}
          pending={pending}
        />
      ) : null}
      <OpenQuestionResolution item={item} onResolve={runPending} pending={pending} />
      <SavedItemControls
        item={item}
        onEdit={() => setEditing((current) => !current)}
        onLifecycle={runLifecycle}
        onPending={runPending}
        pending={pending}
      />
      {active?.state.undoAvailable ? (
        <div className="ml-7">
          <Button
            disabled={active.state.undoRequested}
            onClick={active.requestUndo}
            size="sm"
            type="button"
            variant="outline"
          >
            {active.state.undoRequested ? "Undoing…" : active.state.labels.undo}
          </Button>
        </div>
      ) : null}
      {active?.state.error ? (
        <div className="ml-7">
          <ErrorText message={active.state.error} />
        </div>
      ) : null}
    </article>
  );
}

function SavedItemSummary({ item }: { item: SavedItemView }) {
  const Icon =
    item.kind === "link" ? LinkIcon : item.kind === "open_question" ? CircleHelpIcon : BookmarkIcon;
  return (
    <div className="flex items-start gap-3">
      <Icon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium text-[length:var(--text-title)] leading-[var(--text-title-line)]">
            {item.title}
          </h2>
          <span className="rounded-full border px-2 py-0.5 text-[length:var(--text-caption)] text-muted-foreground">
            {item.kindLabel}
          </span>
          <ActionScopeChip label={item.visibilityLabel} scope={item.scope} />
        </div>
        {item.content ? (
          <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground">{item.content}</p>
        ) : null}
        {item.url ? (
          <a
            className="mt-1 block w-fit break-all text-sm text-primary underline underline-offset-2"
            href={item.url}
            rel="noreferrer"
            target="_blank"
          >
            {item.url}
          </a>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-2 text-[length:var(--text-caption)] text-muted-foreground">
          {item.bringBackLabel && item.bringBackState ? (
            <RecordTimingChip label={item.bringBackLabel} state={item.bringBackState} />
          ) : null}
          {item.reminderSchedule ? (
            <span className="inline-flex items-center gap-1">
              <BellIcon className="size-3" />
              {item.reminderSchedule.label}
            </span>
          ) : null}
          {item.resolutionReason ? <span>Resolved · {item.resolutionReason}</span> : null}
        </div>
      </div>
    </div>
  );
}

function SavedItemOutcomes({ item }: { item: SavedItemView }) {
  if (!item.outcomes.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 pl-7 text-sm">
      <span className="text-muted-foreground">Linked outcome</span>
      {item.outcomes.map((outcome) => (
        <Link
          className="rounded-md underline underline-offset-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          href={`/actions?focus=${outcome.destinationRecordId}`}
          key={outcome.destinationRecordId}
        >
          {outcome.label}
        </Link>
      ))}
    </div>
  );
}

function SourceGroundingDetails({
  item,
  onDelete,
}: {
  item: SavedItemView;
  onDelete: (savedItemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [impact, setImpact] = useState<SourceDeletionImpact | null>(null);
  return (
    <Collapsible
      className="pl-7 text-[length:var(--text-small)] text-muted-foreground"
      onOpenChange={setOpen}
      open={open}
    >
      {/* The chevron stands in for the `<summary>` marker this replaced - without it
          the line reads as a caption rather than something that opens. */}
      <CollapsibleTrigger className="group flex w-fit cursor-pointer items-center gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 shrink-0 transition-transform duration-150 ease-(--motion-ease-out) group-data-[state=open]:rotate-180"
        />
        Source grounding
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col items-start gap-1">
        <code className="font-mono text-[length:var(--text-caption)]">{item.sourceRecordId}</code>
        <p>
          {item.outcomes.length
            ? "Deleting this source would affect the linked outcome. Check the impact first."
            : "Archive keeps this evidence. Source deletion is a separate privacy action."}
        </p>
        <Button
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            setImpactError(null);
            try {
              const result = await getSavedItemSourceDeletionImpactAction({
                sourceRecordId: item.sourceRecordId,
              });
              if (!result.ok) throw new Error(result.error);
              setImpact(result.view);
            } catch {
              setImpactError("Could not check the source impact. Try again.");
            } finally {
              setChecking(false);
            }
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          {checking ? "Checking…" : "Check deletion impact"}
        </Button>
        {impact ? (
          <p role="status">
            This source grounds {impact.linkedSavedItemIds.length} Saved Item
            {impact.linkedSavedItemIds.length === 1 ? "" : "s"} and {impact.linkedOutcomes.length}{" "}
            linked outcome{impact.linkedOutcomes.length === 1 ? "" : "s"}, plus{" "}
            {impact.linkedRecords.length} other grounded record
            {impact.linkedRecords.length === 1 ? "" : "s"}.
          </p>
        ) : null}
        <SourceDeletionControls impact={impact} itemId={item.id} onDelete={onDelete} />
        {impactError ? <ErrorText message={impactError} /> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

type SourceDeletionImpact = Extract<
  Awaited<ReturnType<typeof getSavedItemSourceDeletionImpactAction>>,
  { ok: true }
>["view"];

function SourceDeletionControls({
  impact,
  itemId,
  onDelete,
}: {
  impact: SourceDeletionImpact | null;
  itemId: string;
  onDelete: (savedItemId: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!impact || impact.requiresImpactDisclosure) return null;
  if (!armed) {
    return (
      <Button onClick={() => setArmed(true)} size="sm" type="button" variant="ghost">
        Delete this source permanently
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>This permanently deletes the source and this Saved Item.</span>
      <Button
        aria-busy={deleting}
        disabled={deleting}
        onClick={async () => {
          setDeleting(true);
          setError(null);
          try {
            const result = await deleteUniqueSavedItemSourceAction({ savedItemId: itemId });
            if (!result.ok) {
              setError(result.error);
              setDeleting(false);
              return;
            }
            onDelete(itemId);
          } catch {
            setError("Could not delete this source evidence. Try again.");
            setDeleting(false);
          }
        }}
        size="sm"
        type="button"
        variant="destructive"
      >
        {deleting ? "Deleting…" : "Delete permanently"}
      </Button>
      <Button onClick={() => setArmed(false)} size="sm" type="button" variant="ghost">
        Cancel
      </Button>
      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}

function OpenQuestionResolution({
  item,
  onResolve,
  pending,
}: {
  item: SavedItemView;
  onResolve: (
    run: () => ReturnType<typeof resolveSavedItemAction>,
    focusTarget: HTMLElement | null,
  ) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  if (item.kind !== "open_question" || item.archived) return null;
  return (
    <form
      className="ml-7 flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (!reason.trim()) return;
        onResolve(
          () => resolveSavedItemAction({ savedItemId: item.id, reason: reason.trim() }),
          event.nativeEvent.submitter instanceof HTMLElement ? event.nativeEvent.submitter : null,
        );
      }}
    >
      <Input
        aria-label="Resolution reason"
        onChange={(event) => setReason(event.target.value)}
        placeholder="What answered this?"
        value={reason}
      />
      <Button disabled={pending || !reason.trim()} size="sm" type="submit">
        {pending ? "Resolving…" : "Resolve question"}
      </Button>
    </form>
  );
}

function SavedItemControls({
  item,
  onEdit,
  onLifecycle,
  onPending,
  pending,
}: {
  item: SavedItemView;
  onEdit: () => void;
  onLifecycle: (intent: "archive" | "reopen", focusTarget: HTMLElement) => void;
  onPending: (
    run: () => ReturnType<typeof archiveSavedItemAction>,
    focusTarget: HTMLElement | null,
  ) => void;
  pending: boolean;
}) {
  if (item.archived) {
    if (item.resolutionReason) return null;
    return (
      <div className="ml-7">
        <Button
          aria-busy={pending}
          disabled={pending}
          onClick={(event) => onLifecycle("reopen", event.currentTarget)}
          size="sm"
          type="button"
          variant="outline"
        >
          <RotateCcwIcon aria-hidden /> {pending ? "Reopening…" : "Reopen"}
        </Button>
      </div>
    );
  }
  return (
    <div className="ml-7 flex flex-wrap gap-2">
      <Button disabled={pending} onClick={onEdit} size="sm" type="button" variant="ghost">
        Edit
      </Button>
      <Button
        aria-busy={pending}
        disabled={pending}
        onClick={(event) =>
          onPending(
            () => promoteSavedItemToGeneralActionAction({ savedItemId: item.id }),
            event.currentTarget,
          )
        }
        size="sm"
        type="button"
        variant="outline"
      >
        <ListPlusIcon aria-hidden /> {pending ? "Updating…" : "Make an action"}
      </Button>
      <Button
        aria-busy={pending}
        disabled={pending}
        onClick={(event) => onLifecycle("archive", event.currentTarget)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ArchiveIcon aria-hidden /> {pending ? "Updating…" : "Archive"}
      </Button>
    </div>
  );
}
