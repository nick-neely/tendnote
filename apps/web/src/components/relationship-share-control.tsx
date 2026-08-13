"use client";

import type { RelationshipRecordKind, Sensitivity, VisibilityChoice } from "@tendnote/domain";
import {
  requiresRestrictedShareConfirmation,
  restrictedShareConfirmationPrompt,
  scopeForVisibilityChoice,
  visibilityChoiceForScope,
  visibilityStatusLabel,
} from "@tendnote/domain";
import type { PrivacyScope } from "@tendnote/domain/privacy";
import { useId, useRef, useState, useTransition } from "react";
import { setRelationshipShareAudienceAction as defaultSetAudienceAction } from "@/app/actions/relationship-shares";
import { ACTION_CONTROL_TOUCH_TARGET } from "@/components/general-action-shared";
import {
  ActionVisibilityField,
  AudiencePreview,
  type ShareableActionMember,
} from "@/components/general-action-visibility-field";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { VisibilityControl, VisibilityStatus } from "@/components/visibility-affordance";

const GENERIC_ERROR = "That didn't go through. Nothing changed, so you can try again.";

export type SetRelationshipShareAudience = typeof defaultSetAudienceAction;

function savedAnnouncement(scope: PrivacyScope, selectedCount: number): string {
  return scope === "private"
    ? "Visibility saved. Only you can see this."
    : `Visibility saved. ${visibilityStatusLabel({ scope, selectedCount })}.`;
}

/**
 * The owner's audience control for one relationship record, and the record's
 * current audience at rest.
 *
 * It renders the row's own metadata line — passed in as `children` — because the
 * control belongs *in* that line rather than under it: a ledger of twenty
 * memories cannot afford a row of chrome per memory, and the calm answer is a
 * trailing word on a line the row was already spending (DESIGN.md §5 Personal
 * Ledger density).
 *
 * A private record shows no chip at all, only the control. Nothing on this
 * surface should announce "not shared" twenty times down a page — private is the
 * default, and the default does not need a badge.
 */
export function RelationshipShareControl({
  recordKind,
  recordId,
  scope,
  sensitivity,
  selectedUserIds,
  shareableMembers,
  householdName = null,
  setAudienceAction = defaultSetAudienceAction,
  children,
}: {
  recordKind: RelationshipRecordKind;
  recordId: string;
  scope: PrivacyScope;
  sensitivity: Sensitivity;
  /** Who is currently selected, for a `shared` record. */
  selectedUserIds: readonly string[];
  shareableMembers: ShareableActionMember[];
  householdName?: string | null;
  setAudienceAction?: SetRelationshipShareAudience;
  /** The row's metadata line, laid out beside the control. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [currentScope, setCurrentScope] = useState<PrivacyScope>(scope);
  const [currentSelected, setCurrentSelected] = useState<readonly string[]>(selectedUserIds);
  const [announcement, setAnnouncement] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Closing the form destroys the control that was focused, so focus has to be
   * put back deliberately or it falls to the document body — which on a ledger
   * of twenty memories means starting the whole tab order again.
   */
  function closeAndRestoreFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      {/*
        Mounted in every state, never conditionally: a live region inserted at
        the same moment as its text is unreliably announced, and the form's
        subtree is destroyed on save — so the region has to outlive the swap to
        carry the confirmation across it.
      */}
      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {children}
          <VisibilityStatus scope={currentScope} selectedCount={currentSelected.length} />
        </span>
        {shareableMembers.length ? (
          <VisibilityControl
            aria-expanded={open}
            className={`${ACTION_CONTROL_TOUCH_TARGET} shrink-0`}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
            ref={triggerRef}
            size="sm"
            type="button"
            variant="ghost"
          />
        ) : null}
      </div>
      {open ? (
        <RelationshipShareForm
          householdName={householdName}
          onCancel={closeAndRestoreFocus}
          onSaved={(state) => {
            setCurrentScope(state.scope);
            setCurrentSelected(state.selectedUserIds);
            // Derived from the answer, not the press: the announcement states
            // what the record's audience now is, not what was asked for.
            setAnnouncement(savedAnnouncement(state.scope, state.selectedUserIds.length));
            closeAndRestoreFocus();
          }}
          recordId={recordId}
          recordKind={recordKind}
          scope={currentScope}
          selectedUserIds={currentSelected}
          sensitivity={sensitivity}
          setAudienceAction={setAudienceAction}
          shareableMembers={shareableMembers}
        />
      ) : null}
    </>
  );
}

// fallow-ignore-next-line complexity -- One owner-scoped boundary owns the audience choice, its restricted confirmation, and the commit.
function RelationshipShareForm({
  recordKind,
  recordId,
  scope,
  sensitivity,
  selectedUserIds,
  shareableMembers,
  householdName,
  setAudienceAction,
  onSaved,
  onCancel,
}: {
  recordKind: RelationshipRecordKind;
  recordId: string;
  scope: PrivacyScope;
  sensitivity: Sensitivity;
  selectedUserIds: readonly string[];
  shareableMembers: ShareableActionMember[];
  householdName: string | null;
  setAudienceAction: SetRelationshipShareAudience;
  onSaved: (state: { scope: PrivacyScope; selectedUserIds: string[] }) => void;
  onCancel: () => void;
}) {
  const confirmId = useId();
  const [choice, setChoice] = useState<VisibilityChoice>(visibilityChoiceForScope(scope));
  const [selected, setSelected] = useState<string[]>([...selectedUserIds]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nextScope = scopeForVisibilityChoice(choice);
  const needsAudience = choice === "selected_members" && selected.length === 0;
  const needsConfirmation = requiresRestrictedShareConfirmation({ sensitivity, scope: nextScope });
  const changed = choice !== visibilityChoiceForScope(scope) || nextScope === "shared";

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-card px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (needsAudience || (needsConfirmation && !confirmed) || pending) return;
        setError(null);
        startTransition(async () => {
          try {
            const result = await setAudienceAction({
              recordKind,
              recordId,
              visibilityChoice: choice,
              ...(selected.length ? { selectedUserIds: selected } : {}),
              ...(needsConfirmation ? { confirmedRestricted: true } : {}),
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            onSaved({
              scope: result.view.scope,
              selectedUserIds: result.view.selectedUserIds,
            });
          } catch {
            setError(GENERIC_ERROR);
          }
        });
      }}
    >
      <ActionVisibilityField
        members={shareableMembers}
        name={`relationship-share-${recordId}`}
        onChoiceChange={(next) => {
          setChoice(next);
          // A confirmation is about one audience. Changing the audience retracts it.
          setConfirmed(false);
        }}
        onSelectedChange={(userIds) => {
          setSelected(userIds);
          setConfirmed(false);
        }}
        selectedUserIds={selected}
        value={choice}
      />
      {/*
        Future tense, and only when there is actually someone to replace. Opening
        the control on an already-shared record used to greet the owner with a
        past-tense sentence about their audience being cleared, which reads as
        something that already happened to them.
      */}
      {choice === "selected_members" && selectedUserIds.length ? (
        <p className="text-[length:var(--text-caption)] text-muted-foreground">
          Saving will replace who this is shared with.
        </p>
      ) : null}
      {changed ? (
        <AudiencePreview
          choice={choice}
          householdSize={shareableMembers.length + 1}
          selectedCount={selected.length}
        />
      ) : null}
      {/*
        The second yes for restricted content. It names the audience in full and
        states plainly that they will be able to read it — a deliberate beat, not
        a warning, and it resets whenever the audience changes underneath it.
      */}
      {needsConfirmation ? (
        <Label
          className="flex items-start gap-2.5 rounded-md border border-border bg-surface p-3 text-[length:var(--text-small)] font-normal leading-[var(--text-small-line)]"
          htmlFor={confirmId}
        >
          <Checkbox
            checked={confirmed}
            className="mt-0.5"
            id={confirmId}
            onCheckedChange={(value) => setConfirmed(value === true)}
          />
          <span className="min-w-0">
            {restrictedShareConfirmationPrompt({
              recordKind,
              scope: nextScope === "household" ? "household" : "shared",
              householdName,
              audienceNames: shareableMembers
                .filter((member) => selected.includes(member.userId))
                .map((member) => member.name),
            })}
          </span>
        </Label>
      ) : null}
      <div className="flex items-center justify-end gap-1.5">
        <Button
          className={ACTION_CONTROL_TOUCH_TARGET}
          onClick={onCancel}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          className={ACTION_CONTROL_TOUCH_TARGET}
          disabled={pending || needsAudience || (needsConfirmation && !confirmed)}
          size="sm"
          type="submit"
        >
          {pending ? <Spinner /> : <CheckIcon />}
          Save visibility
        </Button>
      </div>
      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
