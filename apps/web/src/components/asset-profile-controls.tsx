"use client";

import type { AssetKind } from "@tendnote/domain";
import { ASSET_KIND_OPTIONS } from "@tendnote/domain";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { archiveAssetAction, editAssetAction, restoreAssetAction } from "@/app/actions/assets";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { ArchiveIcon, ArchiveRestoreIcon, PencilLineIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { AssetMutationResult, AssetView } from "@/lib/asset-view";
import type { OwnerActionConflict } from "@/lib/owner-action-result";
import { usePendingMutationSubmit } from "@/lib/reversible-mutation";

/**
 * Runs an Asset Profile mutation through the shared submit runner, refreshing the
 * server-rendered profile on success so the page stays the single source of truth.
 */
function useAssetProfileMutation() {
  const router = useRouter();
  const { error, setError, pending, submit } = usePendingMutationSubmit(GENERIC_ERROR);

  function run(
    action: () => Promise<AssetMutationResult>,
    after?: () => void,
    onConflict?: (conflict: NonNullable<OwnerActionConflict>) => string,
  ): void {
    submit(
      action,
      () => {
        after?.();
        router.refresh();
      },
      (result) => (result.conflict && onConflict ? onConflict(result.conflict) : undefined),
    );
  }

  return { error, setError, pending, run };
}

/**
 * The Asset Profile's quiet action row: edit (name and kind) and
 * archive/restore. Archive is the normal set-aside — an outline button with plain
 * language, never a destructive treatment; restore sits in the same spot when
 * archived. Both act through the shared lifecycle and refresh the
 * server-rendered profile, so the page stays the single source of truth (ADR 0153).
 *
 * Which of them appear comes from `asset.authority`, not from `owned`: the same
 * button is the owner's alone on a member-owned Asset and every active member's
 * on the household's own (ADR 0214). The server proves each one again on the
 * write, so this is what to show, never what is allowed (ADR 0219).
 */
export function AssetProfileControls({ asset, members }: AssetControlsProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <AssetEditForm asset={asset} members={members} onDone={() => setEditing(false)} />;
  }
  return <AssetLifecycleButtons asset={asset} onEdit={() => setEditing(true)} />;
}

type AssetControlsProps = {
  asset: AssetView;
  /**
   * The household roster, for naming whoever got to a shared edit first. Empty
   * on a private Asset, which has no second writer to name.
   */
  members?: ShareableActionMember[];
};

/**
 * The inline edit form for an Asset's content — name plus its kind, behind the
 * same select vocabulary as the create form. Submits only real changes; cancel
 * discards them.
 */
function AssetEditForm({
  asset,
  members = [],
  onDone,
}: AssetControlsProps & { onDone: () => void }) {
  const [name, setName] = useState(asset.name);
  const [kind, setKind] = useState<AssetKind>(asset.kind);
  // Set once the writer has been shown what is there now, so the submit that
  // follows is the deliberate replace the message offered them — and cleared
  // again as soon as one lands, so a member who keeps editing after resolving
  // one conflict is fenced against the next.
  const [replace, setReplace] = useState(false);
  const { error, pending, run } = useAssetProfileMutation();
  const trimmedName = name.trim();
  const nameChanged = trimmedName !== asset.name;
  const kindChanged = kind !== asset.kind;

  function submitEdit() {
    if (!trimmedName || (!nameChanged && !kindChanged)) {
      onDone();
      return;
    }
    run(
      () =>
        editAssetAction({
          assetId: asset.id,
          ...(nameChanged ? { name: trimmedName } : {}),
          ...(kindChanged ? { kind } : {}),
          ...(replace ? {} : { expectedRevision: asset.contentRevision }),
        }),
      () => {
        setReplace(false);
        onDone();
      },
      (conflict) => {
        // The draft stays in the inputs, untouched. The member is told what the
        // record reads now and who put it there, and the same Save is what
        // replaces it — never a silent overwrite, and never a lost edit.
        //
        // The actor arrives as an id and is named from the roster this surface
        // already holds; an unresolvable one settles to "Someone" rather than
        // showing a raw id to a person.
        setReplace(true);
        const actor = members.find((member) => member.userId === conflict.actorUserId)?.name;
        return `${actor ?? "Someone"} changed this to “${conflict.currentValue}”. Save again to replace it with yours.`;
      },
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submitEdit();
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label="Asset name"
          autoFocus
          className="sm:max-w-sm"
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
        <div className="flex items-center gap-2">
          <Select onValueChange={(next) => setKind(next as AssetKind)} value={kind}>
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
          <Button disabled={pending || !trimmedName} size="sm" type="submit">
            {pending ? <Spinner /> : null}
            Save
          </Button>
          <Button onClick={onDone} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
        </div>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}

/** Edit (active-only) beside the archive/restore lifecycle button. */
function AssetLifecycleButtons({ asset, onEdit }: { asset: AssetView; onEdit: () => void }) {
  const { error, pending, run } = useAssetProfileMutation();
  const lifecycleAction = asset.archived ? restoreAssetAction : archiveAssetAction;
  const LifecycleIcon = asset.archived ? ArchiveRestoreIcon : ArchiveIcon;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {asset.authority.edit && !asset.archived ? (
          <Button onClick={onEdit} size="sm" type="button" variant="ghost">
            <PencilLineIcon />
            Edit
          </Button>
        ) : null}
        {/* Absent rather than disabled for a member who may not: a greyed
            control is a promise the product is not making, and the row stays
            quiet instead of showing what someone cannot have. */}
        {asset.authority.archive ? (
          <Button
            disabled={pending}
            onClick={() => run(() => lifecycleAction({ assetId: asset.id }))}
            size="sm"
            type="button"
            variant="outline"
          >
            {pending ? <Spinner /> : <LifecycleIcon />}
            {asset.archived ? "Restore" : "Archive"}
          </Button>
        ) : null}
      </div>
      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}
