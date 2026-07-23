"use client";

import type { AssetKind } from "@tendnote/domain";
import { ASSET_KIND_OPTIONS } from "@tendnote/domain";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { archiveAssetAction, editAssetAction, restoreAssetAction } from "@/app/actions/assets";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
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
import { useMutationSubmit } from "@/lib/use-mutation-submit";

/**
 * Runs an Asset Profile mutation through the shared submit runner, refreshing the
 * server-rendered profile on success so the page stays the single source of truth.
 */
function useAssetProfileMutation() {
  const router = useRouter();
  const { error, setError, pending, submit } = useMutationSubmit(GENERIC_ERROR);

  function run(action: () => Promise<AssetMutationResult>, after?: () => void): void {
    submit(action, () => {
      after?.();
      router.refresh();
    });
  }

  return { error, setError, pending, run };
}

/**
 * The Asset Profile's quiet action row: edit (owner-only, name and kind) and
 * archive/restore. Archive is the normal set-aside — an outline button with plain
 * language, never a destructive treatment; restore sits in the same spot when
 * archived. Both act through the shared owner-scoped lifecycle and refresh the
 * server-rendered profile, so the page stays the single source of truth (ADR 0153).
 */
export function AssetProfileControls({ asset }: { asset: AssetView }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <AssetEditForm asset={asset} onDone={() => setEditing(false)} />;
  }
  return <AssetLifecycleButtons asset={asset} onEdit={() => setEditing(true)} />;
}

/**
 * The inline edit form for an Asset's content — name plus its kind, behind the
 * same select vocabulary as the create form. Submits only real changes; cancel
 * discards them.
 */
function AssetEditForm({ asset, onDone }: { asset: AssetView; onDone: () => void }) {
  const [name, setName] = useState(asset.name);
  const [kind, setKind] = useState<AssetKind>(asset.kind);
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
        }),
      onDone,
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

/** Edit (owner-only, active-only) beside the archive/restore lifecycle button. */
function AssetLifecycleButtons({ asset, onEdit }: { asset: AssetView; onEdit: () => void }) {
  const { error, pending, run } = useAssetProfileMutation();
  const lifecycleAction = asset.archived ? restoreAssetAction : archiveAssetAction;
  const LifecycleIcon = asset.archived ? ArchiveRestoreIcon : ArchiveIcon;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {asset.owned && !asset.archived ? (
          <Button onClick={onEdit} size="sm" type="button" variant="ghost">
            <PencilLineIcon />
            Edit
          </Button>
        ) : null}
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
      </div>
      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}
