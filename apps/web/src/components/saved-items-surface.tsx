"use client";

import type { SavedItemKind } from "@tendnote/domain";
import type { VisibilityChoice } from "@tendnote/domain/privacy";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  archiveSavedItemAction,
  createSavedItemAction,
  deleteUniqueSavedItemSourceAction,
  getSavedItemSourceDeletionImpactAction,
  promoteSavedItemToGeneralActionAction,
  reopenSavedItemAction,
  resolveSavedItemAction,
} from "@/app/actions/saved-items";
import {
  GeneralActionReminderField,
  ReminderOptInInvitation,
} from "@/components/general-action-reminder";
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
  CircleHelpIcon,
  LinkIcon,
  ListPlusIcon,
  RotateCcwIcon,
} from "@/components/icons";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { SavedItemEditForm } from "@/components/saved-item-edit-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SavedItemView } from "@/lib/saved-item-view";
import { useMutationSubmit } from "@/lib/use-mutation-submit";
import { useReminderSchedule } from "@/lib/use-reminder-schedule";

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
  items,
  shareableMembers = [],
}: {
  items: SavedItemView[];
  shareableMembers?: ShareableActionMember[];
}) {
  const [list, setList] = useState(items);
  const [state, setState] = useState<"active" | "archived">("active");
  useEffect(() => setList(items), [items]);

  const visible = list.filter((item) => item.status === state);
  function upsert(item: SavedItemView) {
    setList((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
  }
  function remove(savedItemId: string) {
    setList((current) => current.filter((entry) => entry.id !== savedItemId));
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
            onClick={() => setState(value)}
            size="sm"
            variant={state === value ? "secondary" : "ghost"}
          >
            {value === "active" ? "Active" : "Archived"}
          </Button>
        ))}
      </fieldset>

      {visible.length ? (
        <LedgerList>
          {visible.map((item) => (
            <SavedItemRow item={item} key={item.id} onDelete={remove} onUpdate={upsert} />
          ))}
        </LedgerList>
      ) : (
        <LedgerEmpty>
          {state === "active" ? "Nothing saved here yet." : "No archived Saved Items."}
        </LedgerEmpty>
      )}
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
  const [draft, setDraft] = useState(EMPTY_SAVED_ITEM_DRAFT);
  const {
    choice: reminderChoice,
    enabled: reminderEnabled,
    reset: resetReminder,
    save: saveSchedule,
    setChoice: setReminderChoice,
    setEnabled: setReminderEnabled,
  } = useReminderSchedule();
  const [optInInstallationId, setOptInInstallationId] = useState<string | null>(null);
  const { error, setError, pending, submit } = useMutationSubmit(GENERIC_ERROR);
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
                const reminder = await saveSchedule("saved_item", item.id, "instant");
                if (reminder.nextValidChoice) {
                  onCreate(item);
                  reset();
                  setError(
                    `The Saved Item was saved, but that alert time has passed. Choose ${reminder.nextValidChoice.label} when you edit its reminder.`,
                  );
                  return;
                }
                view = {
                  ...item,
                  reminderSchedule: reminder.scheduleView,
                };
                if (reminder.optIn.state === "offer") {
                  setOptInInstallationId(reminder.clientInstallationId);
                }
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
          onSelectedChange={(value) => updateDraft({ selectedUserIds: value })}
          onToggle={() => updateDraft({ showSharing: !showSharing })}
          selectedUserIds={selectedUserIds}
          show={showSharing}
          value={visibilityChoice}
        />

        {error ? <ErrorText message={error} /> : null}
      </form>
      {optInInstallationId ? (
        <ReminderOptInInvitation
          clientInstallationId={optInInstallationId}
          onDismiss={() => setOptInInstallationId(null)}
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
  const titleId = useId();
  const urlId = useId();
  const contentId = useId();
  const isQuestion = kind === "open_question";
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Kind
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onChange={(event) => onKindChange(event.target.value as SavedItemKind)}
            value={kind}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
      <label
        className="flex max-w-xs flex-1 flex-col gap-1.5 text-sm font-medium"
        htmlFor={bringBackAtId}
      >
        Bring back
        <Input
          id={bringBackAtId}
          onChange={(event) => onBringBackAtChange(event.target.value)}
          type="datetime-local"
          value={bringBackAt}
        />
      </label>
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
  onSelectedChange,
  onToggle,
  selectedUserIds,
  show,
  value,
}: {
  members: ShareableActionMember[];
  onChoiceChange: (value: VisibilityChoice) => void;
  onSelectedChange: (value: string[]) => void;
  onToggle: () => void;
  selectedUserIds: string[];
  show: boolean;
  value: VisibilityChoice;
}) {
  const id = useId();
  if (!members.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <button
        aria-controls={id}
        aria-expanded={show}
        className="self-start rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onToggle}
        type="button"
      >
        Share with your household
      </button>
      {show ? (
        <div className="flex flex-col gap-2" id={id}>
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
        </div>
      ) : null}
    </div>
  );
}

function SavedItemRow({
  item,
  onDelete,
  onUpdate,
}: {
  item: SavedItemView;
  onDelete: (savedItemId: string) => void;
  onUpdate: (item: SavedItemView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { error, pending, submit } = useMutationSubmit(GENERIC_ERROR);

  function run(runMutation: () => ReturnType<typeof archiveSavedItemAction>) {
    submit(runMutation, (updated) => {
      onUpdate(updated);
      setEditing(false);
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
          onSave={run}
          pending={pending}
        />
      ) : null}
      <OpenQuestionResolution item={item} onResolve={run} pending={pending} />
      <SavedItemControls
        item={item}
        onEdit={() => setEditing((current) => !current)}
        onRun={run}
        pending={pending}
      />
      {error ? (
        <div className="ml-7">
          <ErrorText message={error} />
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
          {item.bringBackLabel ? <span>{item.bringBackLabel}</span> : null}
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
  const [checking, setChecking] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [impact, setImpact] = useState<Awaited<
    ReturnType<typeof getSavedItemSourceDeletionImpactAction>
  > | null>(null);
  return (
    <details className="pl-7 text-[length:var(--text-small)] text-muted-foreground">
      <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        Source grounding
      </summary>
      <div className="mt-2 flex flex-col items-start gap-1">
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
              setImpact(
                await getSavedItemSourceDeletionImpactAction({
                  sourceRecordId: item.sourceRecordId,
                }),
              );
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
      </div>
    </details>
  );
}

function SourceDeletionControls({
  impact,
  itemId,
  onDelete,
}: {
  impact: Awaited<ReturnType<typeof getSavedItemSourceDeletionImpactAction>> | null;
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
            await deleteUniqueSavedItemSourceAction({ savedItemId: itemId });
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
  onResolve: (run: () => ReturnType<typeof resolveSavedItemAction>) => void;
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
        onResolve(() => resolveSavedItemAction({ savedItemId: item.id, reason: reason.trim() }));
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
  onRun,
  pending,
}: {
  item: SavedItemView;
  onEdit: () => void;
  onRun: (run: () => ReturnType<typeof archiveSavedItemAction>) => void;
  pending: boolean;
}) {
  if (item.archived) {
    if (item.resolutionReason) return null;
    return (
      <div className="ml-7">
        <Button
          aria-busy={pending}
          disabled={pending}
          onClick={() => onRun(() => reopenSavedItemAction({ savedItemId: item.id }))}
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
        onClick={() => onRun(() => promoteSavedItemToGeneralActionAction({ savedItemId: item.id }))}
        size="sm"
        type="button"
        variant="outline"
      >
        <ListPlusIcon aria-hidden /> {pending ? "Updating…" : "Make an action"}
      </Button>
      <Button
        aria-busy={pending}
        disabled={pending}
        onClick={() => onRun(() => archiveSavedItemAction({ savedItemId: item.id }))}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ArchiveIcon aria-hidden /> {pending ? "Updating…" : "Archive"}
      </Button>
    </div>
  );
}
