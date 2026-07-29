"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveDraftAction,
  dismissDraftAction,
  editDraftBodyAction,
  markDraftSentManuallyAction,
  regenerateDraftAction,
} from "@/app/actions/drafts";
import { DraftBody } from "@/components/draft-body";
import { DraftEditor } from "@/components/draft-editor";
import { DraftGroundingPopover } from "@/components/draft-grounding-popover";
import { DraftMessageButton } from "@/components/draft-message-button";
import { ACTION_CONTROL_TOUCH_TARGET } from "@/components/general-action-shared";
import { GmailDraftPanel, type PersonEmailOption } from "@/components/gmail-draft-panel";
import {
  CheckIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SendIcon,
  XIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyDraftToClipboard } from "@/lib/draft-markdown";
import type { DraftView } from "@/lib/draft-view";
import type { GmailDraftView } from "@/lib/gmail-draft-view";
import { useServerSyncedList } from "@/lib/use-server-synced-list";

/** Gmail externalization context shared by every draft card on the person page. */
export type GmailDraftContext = {
  connected: boolean;
  personName: string | null;
  personEmails: PersonEmailOption[];
  /** Latest inline Gmail state per Tendnote draft id (ADR-0096). */
  byDraftId: Record<string, GmailDraftView | null>;
};

const draftId = (draft: DraftView) => draft.id;
const byNewest = (drafts: DraftView[]) =>
  [...drafts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export function PersonDrafts({
  personId,
  initialDrafts,
  gmail,
}: {
  personId: string;
  initialDrafts: DraftView[];
  gmail: GmailDraftContext;
}) {
  const router = useRouter();
  // Server-synced so a draft started from the button below (or any other entry
  // point that refreshes) appears here instantly, newest first, without dropping
  // the local edits the draft cards make.
  const [drafts, setDrafts] = useServerSyncedList(initialDrafts, draftId, byNewest);

  // Re-read the server after a draft changes so the Drafts tab count (drafts not
  // yet marked sent) stays accurate; the active tab is preserved across refresh.
  function update(view: DraftView) {
    setDrafts((current) => current.map((draft) => (draft.id === view.id ? view : draft)));
    router.refresh();
  }

  function add(view: DraftView) {
    setDrafts((current) => [view, ...current]);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex justify-end">
        {/* Person entry point: draft from this person's relationship context (#79). */}
        <DraftMessageButton personId={personId} purpose="check_in" />
      </div>
      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No message drafts yet.</p>
      ) : (
        drafts.map((draft) => (
          <DraftReviewCard
            draft={draft}
            gmail={gmail}
            key={draft.id}
            onAdd={add}
            onUpdate={update}
          />
        ))
      )}
    </div>
  );
}

/**
 * Everything a draft can do that is not its next step in the approval flow.
 *
 * A person can hold four near-identical generated drafts, and giving each one two
 * adjacent affirmative buttons made the page read as eight equal choices. Exactly
 * one filled button stays on the card - Approve while the draft is still being
 * considered, Mark sent once it is approved - and the rest live here. `Mark sent`
 * remains reachable for a draft the user already sent without approving it first,
 * which the lifecycle allows. Nothing in this menu sends anything.
 */
function DraftOverflowMenu({
  pending,
  onEdit,
  onRegenerate,
  onMarkSent,
  onDismiss,
}: {
  pending: boolean;
  onEdit: () => void;
  onRegenerate: () => void;
  /** Present only while the draft is unapproved; otherwise it is the card's primary. */
  onMarkSent: (() => void) | null;
  onDismiss: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="More draft actions"
          className={`${ACTION_CONTROL_TOUCH_TARGET} max-sm:min-w-11`}
          disabled={pending}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className={ACTION_CONTROL_TOUCH_TARGET} onSelect={onEdit}>
          <PencilIcon />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem className={ACTION_CONTROL_TOUCH_TARGET} onSelect={onRegenerate}>
          <RefreshCwIcon />
          Regenerate
        </DropdownMenuItem>
        {onMarkSent ? (
          <DropdownMenuItem className={ACTION_CONTROL_TOUCH_TARGET} onSelect={onMarkSent}>
            <SendIcon />
            Mark sent
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={ACTION_CONTROL_TOUCH_TARGET} onSelect={onDismiss}>
          <XIcon />
          Dismiss
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DraftReviewCard({
  draft,
  onUpdate,
  onAdd,
  gmail,
}: {
  draft: DraftView;
  onUpdate: (view: DraftView) => void;
  onAdd: (view: DraftView) => void;
  gmail: GmailDraftContext;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isActive = draft.status === "draft" || draft.status === "approved";

  function run(action: () => Promise<void>, failure: string) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch {
        setError(failure);
      }
    });
  }

  async function handleCopy() {
    setError(null);
    try {
      await copyDraftToClipboard(draft.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy to your clipboard.");
    }
  }

  function handleSave(nextBody: string) {
    if (!nextBody || nextBody === draft.body) {
      setIsEditing(false);
      setError(null);
      return;
    }
    run(async () => {
      const updated = await editDraftBodyAction({ draftId: draft.id, body: nextBody });
      if (!updated.ok) throw new Error(updated.error);
      onUpdate(updated.view);
      setIsEditing(false);
    }, "That edit didn't save. Try again.");
  }

  function handleCancelEdit() {
    setIsEditing(false);
    setError(null);
  }

  function handleApprove() {
    run(async () => {
      const result = await approveDraftAction({ draftId: draft.id });
      if (!result.ok) throw new Error(result.error);
      onUpdate(result.view);
    }, "Couldn't approve this draft.");
  }

  function handleMarkSent() {
    run(async () => {
      const result = await markDraftSentManuallyAction({ draftId: draft.id });
      if (!result.ok) throw new Error(result.error);
      onUpdate(result.view);
    }, "Couldn't update this draft.");
  }

  function handleDismiss() {
    run(async () => {
      const result = await dismissDraftAction({ draftId: draft.id });
      if (!result.ok) throw new Error(result.error);
      onUpdate(result.view);
    }, "Couldn't dismiss this draft.");
  }

  function handleRegenerate() {
    run(async () => {
      const result = await regenerateDraftAction({ draftId: draft.id });
      if (!result.ok) throw new Error(result.error);
      if (result.view.draft) {
        onAdd(result.view.draft);
      } else {
        setError("Not enough saved context about this person to regenerate.");
      }
    }, "Couldn't regenerate this draft.");
  }

  return (
    <article
      className="flex flex-col gap-3 rounded-lg border bg-card p-3.5"
      data-status={draft.status}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Neutral, not clay: the Drafts tab already says what these cards are, and a clay
            pill on every card spends the one accent moment §3 allows on repetition. The
            status word carries the state, so the demotion loses no meaning. */}
        <span className="inline-flex shrink-0 items-center rounded-full bg-secondary px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-muted-foreground">
          {draft.statusLabel}
        </span>
        <span className="text-[length:var(--text-caption)] text-muted-foreground capitalize">
          {draft.purpose.replace(/_/g, " ")} · {draft.channel}
        </span>
      </div>

      {isEditing ? (
        <DraftEditor
          ariaLabel="Edit draft"
          markdown={draft.body}
          onCancel={handleCancelEdit}
          onSave={handleSave}
          saving={pending}
        />
      ) : (
        <DraftBody markdown={draft.body} />
      )}

      {isEditing ? null : (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3">
          <DraftGroundingPopover
            grounding={draft.grounding.map((item) => ({ trust: item.trust, label: item.label }))}
          />
          {/* One draft, one next step. Copying is how the user actually sends the
              message, so it stays visible as the secondary action; everything else
              a draft can do moves behind the overflow. */}
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button onClick={handleCopy} size="sm" type="button" variant="outline">
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </Button>
            {isActive ? (
              <>
                {draft.status === "draft" ? (
                  <Button disabled={pending} onClick={handleApprove} size="sm" type="button">
                    <CheckIcon />
                    Approve
                  </Button>
                ) : (
                  <Button disabled={pending} onClick={handleMarkSent} size="sm" type="button">
                    <SendIcon />
                    Mark sent
                  </Button>
                )}
                <DraftOverflowMenu
                  onDismiss={handleDismiss}
                  onEdit={() => setIsEditing(true)}
                  onMarkSent={draft.status === "draft" ? handleMarkSent : null}
                  onRegenerate={handleRegenerate}
                  pending={pending}
                />
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Gmail externalization lives inline on the approved draft card (ADR-0096):
          no separate Gmail page, and only from an approved, source-grounded draft. */}
      {!isEditing && draft.status === "approved" ? (
        <GmailDraftPanel
          connected={gmail.connected}
          draft={draft}
          initialView={gmail.byDraftId[draft.id] ?? null}
          onWrite={() => router.refresh()}
          personEmails={gmail.personEmails}
          personName={gmail.personName}
        />
      ) : null}

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
