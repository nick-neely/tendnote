"use client";

import type { AssetKind } from "@tendnote/domain";
import { ASSET_KIND_OPTIONS } from "@tendnote/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  acceptAssetReviewGroupAction,
  acceptSuggestedAssetAction,
  acceptSuggestedAssetMemoryAction,
  dismissAssetReviewGroupAction,
  dismissSuggestedAssetMemoryAction,
  editSuggestedAssetAction,
  linkAssetReviewGroupAction,
} from "@/app/actions/asset-review";
import { MemoryEditForm } from "@/components/asset-memory-edit-form";
import { AssetReviewEvidenceBlock, DismissGroupButton } from "@/components/asset-review-evidence";
import { AssetKindBadge } from "@/components/asset-shared";
import { ActionScopeChip, GENERIC_ERROR } from "@/components/general-action-shared";
import { CheckIcon, Link2Icon, PencilIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AssetReviewGroupView, AssetReviewMemoryView } from "@/lib/asset-review-view";
import { sourceLabel } from "@/lib/source-labels";

function formatCaptured(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Where this group came from (#199): the General Action whose hint was promoted
 * (grounding a promotion even when it carries no source record), and/or the
 * captured source record. Renders nothing for an ungrounded direct suggestion.
 */
function GroundingBlock({ review }: { review: AssetReviewGroupView }) {
  if (!review.fromAction && !review.source) {
    return null;
  }
  return (
    <div className="border-t border-accent/20 pt-2.5">
      {review.fromAction ? (
        <p className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
          From action · {review.fromAction.title}
        </p>
      ) : null}
      {review.source ? (
        <>
          <p className="mt-1 first:mt-0 font-mono text-[length:var(--text-caption)] text-muted-foreground">
            From {sourceLabel(review.source.sourceType)} · captured{" "}
            {formatCaptured(review.source.capturedAt)}
          </p>
          <p className="mt-1 line-clamp-2 max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
            {review.source.content}
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * An Asset Review Group in the shared Review Queue (#198): one source context
 * reviewed together — the Suggested Asset (or the existing Asset gaining
 * details), its Suggested Asset Memories, the duplicate link-to-existing prompt,
 * and the source grounding. Everything is tentative until accepted: each detail
 * can be edited inline before accepting, straightforward groups resolve in one
 * calm batch action, and dismissing carries no guilt (DESIGN.md §2). Matches the
 * Suggested-action card vocabulary so the Review tab reads as one system.
 */
export function AssetReviewGroupCard({
  review,
  onResolve,
  onUpdate,
}: {
  review: AssetReviewGroupView;
  onResolve: (groupId: string) => void;
  onUpdate?: (view: AssetReviewGroupView) => void;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Runs a review mutation; the returned view either updates the card or resolves it. */
  function run(mutate: () => Promise<AssetReviewGroupView>) {
    setError(null);
    startTransition(async () => {
      try {
        const view = await mutate();
        // Keep the Review tab count honest after members resolve.
        router.refresh();
        if (view.pendingCount === 0) {
          setLeaving(true);
          window.setTimeout(() => onResolve(review.groupId), 200);
        } else {
          onUpdate?.(view);
        }
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  const memoryCount = review.memories.length;
  const batchable = review.pendingCount > 1;

  return (
    <article
      className="flex flex-col gap-3 rounded-lg border border-accent/25 bg-accent-soft/45 p-3.5 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
      data-leaving={leaving}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          {review.asset.pending ? "Suggested asset" : "Suggested details"}
        </span>
        {review.asset.scope !== "private" ? (
          <ActionScopeChip label={review.asset.visibilityLabel} scope={review.asset.scope} />
        ) : null}
      </div>

      {/* Content-keyed so a successful inline edit remounts with fresh drafts. */}
      <AnchorBlock
        disabled={pending}
        key={`${review.asset.id}:${review.asset.name}:${review.asset.kind}`}
        review={review}
        run={run}
      />

      {review.asset.pending && review.duplicates.length > 0 ? (
        <DuplicatePrompt disabled={pending} review={review} run={run} />
      ) : null}

      {memoryCount > 0 ? (
        <ul className="flex flex-col divide-y divide-accent/15 rounded-md border border-accent/20 bg-background/60">
          {review.memories.map((memory) => (
            <MemoryRow
              disabled={pending}
              key={`${memory.id}:${memory.label}:${memory.valueLabel ?? ""}:${memory.notes ?? ""}`}
              memory={memory}
              run={run}
            />
          ))}
        </ul>
      ) : null}

      {/* Evidence captured for this group — attachable before the destination
          Asset is accepted, reviewed alongside what it grounds (#200). */}
      <AssetReviewEvidenceBlock
        disabled={pending}
        onEvidenceChange={(evidence) => onUpdate?.({ ...review, evidence })}
        review={review}
      />

      <GroundingBlock review={review} />

      <div className="flex flex-col gap-2 border-t border-accent/20 pt-3">
        {/* Name the outcome plainly so nothing is resolved blind (calm, honest). */}
        <p className="text-[length:var(--text-caption)] text-muted-foreground">
          {review.asset.pending
            ? "Accept keeps this asset and its details. Dismiss clears the whole suggestion."
            : "Accepted details are added to the asset. Dismiss clears the rest."}
        </p>
        {/* biome-ignore lint/a11y/useSemanticElements: a related-controls group, not a form fieldset */}
        <div
          aria-label="Review this asset suggestion"
          className="flex flex-wrap items-center justify-end gap-1.5"
          role="group"
        >
          {/* Dismissing a pending proposal deletes its captured evidence with it —
              the reviewer confirms that explicitly, never by accident (#196). */}
          <DismissGroupButton
            batchable={batchable}
            disabled={pending}
            evidenceAtRisk={review.asset.pending ? review.evidence.length : 0}
            onDismiss={() => run(() => dismissAssetReviewGroupAction({ groupId: review.groupId }))}
          />
          <Button
            disabled={pending}
            onClick={() => run(() => acceptAssetReviewGroupAction({ groupId: review.groupId }))}
            size="sm"
            type="button"
          >
            <CheckIcon />
            {batchable ? "Accept all" : "Accept"}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

/**
 * The group's anchor: a pending Suggested Asset with inline name/kind edit, or a
 * quiet deep link into the existing Asset the details will land on.
 */
function AnchorBlock({
  review,
  run,
  disabled,
}: {
  review: AssetReviewGroupView;
  run: (mutate: () => Promise<AssetReviewGroupView>) => void;
  disabled: boolean;
}) {
  const { asset } = review;
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(asset.name);
  const [draftKind, setDraftKind] = useState<AssetKind>(asset.kind);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Keyboard-first edit: focus lands in the name field, not behind the form.
  useEffect(() => {
    if (isEditing) {
      nameInputRef.current?.focus();
    }
  }, [isEditing]);

  const trimmedName = draftName.trim();
  const changed = trimmedName !== asset.name || draftKind !== asset.kind;

  function buildEdit() {
    return {
      ...(trimmedName && trimmedName !== asset.name ? { name: trimmedName } : {}),
      ...(draftKind !== asset.kind ? { kind: draftKind } : {}),
    };
  }

  if (!asset.pending) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          className="min-w-0 truncate font-medium text-[length:var(--text-body)] underline-offset-4 transition-colors hover:underline"
          href={`/assets/${asset.id}`}
        >
          {asset.name}
        </Link>
        <AssetKindBadge kind={asset.kind} label={asset.kindLabel} />
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Asset name"
            className="min-w-40 flex-1"
            onChange={(event) => setDraftName(event.target.value)}
            ref={nameInputRef}
            value={draftName}
          />
          <Select onValueChange={(next) => setDraftKind(next as AssetKind)} value={draftKind}>
            <SelectTrigger aria-label="Kind" className="min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSET_KIND_OPTIONS.map((option) => (
                <SelectItem key={option.kind} value={option.kind}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-end gap-1.5">
          <Button
            onClick={() => {
              setDraftName(asset.name);
              setDraftKind(asset.kind);
              setIsEditing(false);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={disabled || !trimmedName || !changed}
            onClick={() => {
              run(() => editSuggestedAssetAction({ assetId: asset.id, edit: buildEdit() }));
              setIsEditing(false);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Apply edit
          </Button>
          <Button
            disabled={disabled || !trimmedName}
            onClick={() =>
              run(() => acceptSuggestedAssetAction({ assetId: asset.id, edit: buildEdit() }))
            }
            size="sm"
            type="button"
          >
            <CheckIcon />
            Accept asset
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 truncate font-medium text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          {asset.name}
        </span>
        <AssetKindBadge kind={asset.kind} label={asset.kindLabel} />
      </div>
      <div className="flex items-center gap-1">
        <Button
          aria-label={`Edit suggested asset: ${asset.name}`}
          disabled={disabled}
          onClick={() => setIsEditing(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PencilIcon />
          Edit
        </Button>
        <Button
          aria-label={`Accept suggested asset: ${asset.name}`}
          disabled={disabled}
          onClick={() => run(() => acceptSuggestedAssetAction({ assetId: asset.id }))}
          size="sm"
          type="button"
        >
          <CheckIcon />
          Accept asset
        </Button>
      </div>
    </div>
  );
}

/**
 * The duplicate-review prompt: a calm question, never an alarm. Linking uses the
 * existing Asset instead of creating a near-duplicate; keeping it separate is
 * just accepting as usual, so no extra "keep" control is needed.
 */
function DuplicatePrompt({
  review,
  run,
  disabled,
}: {
  review: AssetReviewGroupView;
  run: (mutate: () => Promise<AssetReviewGroupView>) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-accent/30 px-3 py-2.5">
      <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        Already tracking something like this? Linking adds these details there instead.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {review.duplicates.map((candidate) => (
          <Button
            disabled={disabled}
            key={candidate.id}
            onClick={() =>
              run(() =>
                linkAssetReviewGroupAction({
                  groupId: review.groupId,
                  targetAssetId: candidate.id,
                }),
              )
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <Link2Icon />
            Link to {candidate.name}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * One Suggested Asset Memory row: the fact at a glance (label, exact value,
 * notes), with inline edit-before-accept and per-detail accept/dismiss so a
 * mostly-right group never forces all-or-nothing.
 */
function MemoryRow({
  memory,
  run,
  disabled,
}: {
  memory: AssetReviewMemoryView;
  run: (mutate: () => Promise<AssetReviewGroupView>) => void;
  disabled: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <MemoryEditForm
        disabled={disabled}
        memory={memory}
        onClose={() => setIsEditing(false)}
        run={run}
      />
    );
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
          {memory.label}
        </span>
        {memory.valueLabel ? (
          <span className="text-[length:var(--text-small)] font-medium leading-[var(--text-small-line)]">
            {memory.valueLabel}
          </span>
        ) : null}
        {memory.notes ? (
          <span className="max-w-[58ch] text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
            {memory.notes}
          </span>
        ) : null}
      </div>
      {/* Text-labeled actions on their own row — the same vocabulary as the
          sibling Suggested-action card, with the opposite outcomes (dismiss vs
          accept) visually separated so neither is one misclick from the other. */}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button
          aria-label={`Edit detail: ${memory.label}`}
          disabled={disabled}
          onClick={() => setIsEditing(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PencilIcon />
          Edit
        </Button>
        <Button
          aria-label={`Dismiss detail: ${memory.label}`}
          disabled={disabled}
          onClick={() => run(() => dismissSuggestedAssetMemoryAction({ memoryId: memory.id }))}
          size="sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
          Dismiss
        </Button>
        <Button
          aria-label={`Accept detail: ${memory.label}`}
          className="ml-2"
          disabled={disabled}
          onClick={() => run(() => acceptSuggestedAssetMemoryAction({ memoryId: memory.id }))}
          size="sm"
          type="button"
        >
          <CheckIcon />
          Accept
        </Button>
      </div>
    </li>
  );
}
