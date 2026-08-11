"use client";

import type { AssetKind } from "@tendnote/domain";
import { ASSET_KIND_OPTIONS } from "@tendnote/domain";
import type { VisibilityChoice } from "@tendnote/domain/privacy";
import { useState } from "react";
import { createAssetAction } from "@/app/actions/assets";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import {
  ActionVisibilityField,
  AudiencePreview,
  type ShareableActionMember,
} from "@/components/general-action-visibility-field";
import { ChevronDownIcon, PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { AssetView } from "@/lib/asset-view";
import { usePendingMutationSubmit } from "@/lib/reversible-mutation";

/**
 * Capture-first create surface for an Asset: name + kind in one reach, so adding
 * "the fridge" takes seconds (DESIGN.md capture speed). Kind is a small fixed set
 * behind a quiet select — never a taxonomy to manage. Sharing lives behind a
 * low-emphasis disclosure that only appears when a household exists, mirroring
 * the Actions create form so capture stays private-first by default (ADR 0153).
 */
export function CreateAssetForm({
  onCreate,
  shareableMembers = [],
}: {
  onCreate: (view: AssetView) => void;
  /** Household members the Asset can be shared with; empty keeps it private-only. */
  shareableMembers?: ShareableActionMember[];
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("item");
  const [visibilityChoice, setVisibilityChoice] = useState<VisibilityChoice>("only_me");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [showSharing, setShowSharing] = useState(false);
  const { error, setError, pending, submit } = usePendingMutationSubmit(GENERIC_ERROR);

  const trimmedName = name.trim();
  const selectedMembersRequired =
    visibilityChoice === "selected_members" && selectedUserIds.length === 0;
  // Choosing the whole household is choosing to hand the thing over, not just to
  // widen who sees it — the same equivalence the Actions composer makes, so one
  // gesture does not mean two things in one product (ADR 0214, #383, #386).
  const householdNative = visibilityChoice === "whole_household";

  function reset() {
    setName("");
    setKind("item");
    setVisibilityChoice("only_me");
    setSelectedUserIds([]);
    setShowSharing(false);
    setError(null);
  }

  function submitAsset() {
    if (!trimmedName || selectedMembersRequired) {
      return;
    }
    submit(
      () =>
        createAssetAction({
          name: trimmedName,
          kind,
          visibilityChoice,
          ...(selectedUserIds.length ? { selectedUserIds } : {}),
        }),
      (view) => {
        onCreate(view);
        reset();
      },
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border bg-surface px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submitAsset();
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label="What do you want to keep track of?"
          className="sm:flex-1"
          onChange={(event) => setName(event.target.value)}
          placeholder="What do you want to keep track of?"
          value={name}
        />
        <div className="flex items-center gap-2">
          <Select onValueChange={(next) => setKind(next as AssetKind)} value={kind}>
            <SelectTrigger aria-label="Kind" className="min-w-36 flex-1 sm:flex-none">
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
          <Button disabled={pending || !trimmedName || selectedMembersRequired} type="submit">
            {pending ? <Spinner /> : <PlusIcon />}
            Add asset
          </Button>
        </div>
      </div>

      {shareableMembers.length > 0 ? (
        <Collapsible
          className="flex flex-col gap-3"
          onOpenChange={setShowSharing}
          open={showSharing}
        >
          <CollapsibleTrigger className="group/sharing inline-flex items-center gap-1 self-start rounded-md text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <ChevronDownIcon
              aria-hidden
              className="size-3.5 transition-transform group-data-[state=open]/sharing:rotate-180 motion-reduce:transition-none"
            />
            Share with your household
          </CollapsibleTrigger>

          <CollapsibleContent className="flex flex-col gap-2.5">
            <ActionVisibilityField
              members={shareableMembers}
              name="asset-visibility"
              onChoiceChange={setVisibilityChoice}
              onSelectedChange={setSelectedUserIds}
              selectedUserIds={selectedUserIds}
              value={visibilityChoice}
            />
            {/* One line, stated once, in the words the Actions composer already
                uses, because the difference is real and not recoverable later.
                Said plainly and left alone — not a warning, not a callout, and
                never repeated on the row afterwards. */}
            {householdNative ? (
              <p className="text-[length:var(--text-small)] text-muted-foreground">
                This becomes the household's, not yours: everyone can edit it, and it stays if you
                leave.
              </p>
            ) : null}
            <AudiencePreview
              choice={visibilityChoice}
              householdSize={shareableMembers.length + 1}
              selectedCount={selectedUserIds.length}
            />
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}
