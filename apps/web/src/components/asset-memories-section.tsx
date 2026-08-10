"use client";

import { type RefObject, useRef, useState } from "react";
import {
  createAssetMemoryAction,
  editAssetMemoryAction,
  restoreAssetMemoryAction,
  setAsideAssetMemoryAction,
} from "@/app/actions/asset-memories";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { HomeIcon, PlusIcon } from "@/components/icons";
import { LedgerList } from "@/components/person-ledger";
import { MutationUndo } from "@/components/suggestion-review-controls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { AssetMemoryMutationResult, AssetMemoryView } from "@/lib/asset-memory-view";
import { captureFocusAfterRemoval } from "@/lib/focus-after-removal";
import {
  ReversibleMutationProvider,
  usePendingMutationSubmit,
  useReversibleMutationController,
} from "@/lib/reversible-mutation";
import { useServerSyncedList } from "@/lib/use-server-synced-list";

/** The one intent key set-aside serializes under, per detail. */
const SET_ASIDE = "set-aside";

type MemoryDraft = { label: string; value: string; notes: string };

const EMPTY_DRAFT: MemoryDraft = { label: "", value: "", notes: "" };

/**
 * The kept details on an Asset, and the two things a member does to them:
 * add one, and correct or set aside one they may write.
 *
 * Personal Ledger density throughout — flat rows on one surface, the fact's name
 * in quiet mono, the value in ink, controls that stay out of the way until the
 * row is reached for. Nothing here is a card, and correction happens in place
 * rather than in a dialog: a detail is a line in a notebook, and opening a modal
 * to fix a filter size would make it feel like a form to fill in.
 */
export function AssetMemoriesSection(props: AssetMemoriesSectionProps) {
  // Its own provider, like the review queue: set-aside is reversible, and the
  // undo window has to be serialized per detail rather than per page.
  return (
    <ReversibleMutationProvider>
      <AssetMemoriesSectionContent {...props} />
    </ReversibleMutationProvider>
  );
}

type AssetMemoriesSectionProps = {
  /** An archived Asset is read-only history — restore it before adding to it. */
  archived: boolean;
  assetId: string;
  /**
   * Whether the household can own a detail here at all. True only under a
   * household-native Asset: a workspace-owned detail on a member's own Asset
   * would leave with them, so the seam refuses it and this never offers it.
   */
  canAddHouseholdDetail: boolean;
  initialMemories: AssetMemoryView[];
  members: ShareableActionMember[];
};

function AssetMemoriesSectionContent({
  archived,
  assetId,
  canAddHouseholdDetail,
  initialMemories,
  members,
}: AssetMemoriesSectionProps) {
  // Instant feedback across the pane: a detail kept, corrected, or set aside
  // shows immediately and is reconciled by the next server render.
  const [items, setItems] = useServerSyncedList(initialMemories, (memory) => memory.id);
  const [adding, setAdding] = useState(false);
  /**
   * The last-resort focus anchor when a set-aside row leaves.
   *
   * The shared helper prefers the neighbouring row, then the pane heading; this
   * catches the case where the row that left was the only one. Without any of
   * them the browser drops focus to `body`, silently returning a keyboard member
   * to the top of the document after acting halfway down it.
   */
  const addAnchorRef = useRef<HTMLButtonElement>(null);

  const replace = (updated: AssetMemoryView) =>
    setItems((current) => current.map((memory) => (memory.id === updated.id ? updated : memory)));

  return (
    <div className="flex flex-col gap-3">
      {items.length > 0 ? (
        <LedgerList>
          {items.map((memory) => (
            <AssetMemoryRow
              key={memory.id}
              focusAnchorRef={addAnchorRef}
              memory={memory}
              members={members}
              onLeft={() =>
                setItems((current) => current.filter((entry) => entry.id !== memory.id))
              }
              onUpdated={replace}
              readOnly={archived}
            />
          ))}
        </LedgerList>
      ) : (
        <EmptyState
          description={
            canAddHouseholdDetail
              ? "Model numbers, filter sizes, warranty dates — anything the household should be able to look up."
              : "Details Tendnote confirms about this asset collect here."
          }
          size="compact"
          title="Nothing remembered about this yet."
        />
      )}

      {archived ? null : adding ? (
        <MemoryForm
          canMarkHousehold={canAddHouseholdDetail}
          draft={EMPTY_DRAFT}
          members={members}
          onCancel={() => setAdding(false)}
          onSubmit={(draft, household) =>
            createAssetMemoryAction({
              assetId,
              label: draft.label,
              value: draft.value,
              notes: draft.notes,
              household,
            })
          }
          onSaved={(memory) => {
            setItems((current) => [...current, memory]);
            setAdding(false);
          }}
          submitLabel="Keep this"
        />
      ) : (
        <Button
          className="self-start"
          onClick={() => setAdding(true)}
          ref={addAnchorRef}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PlusIcon />
          Add a detail
        </Button>
      )}
    </div>
  );
}

/**
 * One kept detail: the fact's name in quiet mono, the exact value in ink,
 * freeform notes underneath — human content first, metadata second.
 *
 * The household glyph sits with the label rather than beside the value, because
 * it says whose fact this is and not what the fact says. Correction and
 * set-aside appear only for a member who may write it; for everyone else the row
 * is simply a line of text, with no disabled control implying otherwise.
 */
function AssetMemoryRow({
  focusAnchorRef,
  members,
  memory,
  onLeft,
  onUpdated,
  readOnly,
}: {
  focusAnchorRef: RefObject<HTMLButtonElement | null>;
  members: ShareableActionMember[];
  memory: AssetMemoryView;
  /** Called once the undo window closes and the row is really gone. */
  onLeft: () => void;
  onUpdated: (memory: AssetMemoryView) => void;
  readOnly: boolean;
}) {
  const [correcting, setCorrecting] = useState(false);
  const mutations = useReversibleMutationController();
  const setAside = mutations.state(memory.id, SET_ASIDE);

  function setAsideDetail(trigger: HTMLElement) {
    // Captured before the row leaves, while its neighbours are still in the DOM.
    const moveFocus = captureFocusAfterRemoval(
      trigger.closest<HTMLElement>("[data-asset-memory-row]"),
      "h2, h3",
      () => focusAnchorRef.current,
    );
    mutations.run(memory.id, SET_ASIDE, {
      kind: "optimistic",
      prior: memory,
      adapter: {
        // The row stays exactly as it reads until the undo window closes; only
        // then does it leave. Nothing is projected away in between, so an undo
        // has something to come back to.
        project: (prior) => prior,
        inverse: () => restoreAssetMemoryAction({ memoryId: memory.id }),
      },
      apply: (view) => {
        onUpdated(view);
        return true;
      },
      command: () => setAsideAssetMemoryAction({ memoryId: memory.id }),
      focusTarget: trigger,
      labels: {
        pending: "Setting aside…",
        // Names the detail rather than announcing "Updated": a member hearing
        // this five rows down needs to know *which* fact stopped being true.
        success: `“${memory.label}” set aside. Undo available.`,
        rollback: `“${memory.label}” is still here.`,
        undo: "Undo set aside",
        undone: `“${memory.label}” is back.`,
      },
      leave: {
        apply: () => {
          onLeft();
          moveFocus();
          return true;
        },
      },
    });
  }

  if (correcting) {
    return (
      <div className="px-4 py-3">
        <MemoryForm
          canMarkHousehold={false}
          draft={{
            label: memory.label,
            value: memory.valueText ?? "",
            notes: memory.notes ?? "",
          }}
          expectedRevision={memory.revision}
          members={members}
          onCancel={() => setCorrecting(false)}
          // Both content fields always travel, so emptying one is the clear the
          // member meant rather than a key that silently went missing.
          onSubmit={(draft, _household, expectedRevision) =>
            editAssetMemoryAction({
              memoryId: memory.id,
              label: draft.label,
              value: draft.value,
              notes: draft.notes,
              ...(expectedRevision === null ? {} : { expectedRevision }),
            })
          }
          onSaved={(updated) => {
            onUpdated(updated);
            setCorrecting(false);
          }}
          submitLabel="Save"
        />
      </div>
    );
  }

  return (
    <div
      className="scroll-mt-32 flex flex-col gap-0.5 px-4 py-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      data-asset-memory-row
      id={`asset-memory-${memory.id}`}
      tabIndex={-1}
    >
      <span className="inline-flex items-center gap-1.5 font-mono text-[length:var(--text-caption)] text-muted-foreground">
        {memory.label}
        {memory.ownership === "household_native" ? (
          <HomeIcon aria-label="The household's detail" className="size-3 shrink-0" />
        ) : null}
      </span>
      {memory.valueLabel ? (
        <span className="font-medium text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          {memory.valueLabel}
        </span>
      ) : null}
      {memory.notes ? (
        <p className="max-w-[68ch] text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {memory.notes}
        </p>
      ) : null}
      {memory.canWrite && !readOnly ? (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1">
          <Button onClick={() => setCorrecting(true)} size="sm" type="button" variant="ghost">
            Correct
          </Button>
          {/* "Set aside", never "Delete": nothing is removed, the detail simply
              stops being true of this asset and its history stays intact — and
              the Undo below is what makes that promise good rather than merely
              worded. Separated from Correct by a rule of space rather than a
              divider, so the reversible act does not sit flush against the
              routine one. */}
          <span aria-hidden className="w-2" />
          <Button
            disabled={setAside.pending || setAside.leaving}
            onClick={(event) => setAsideDetail(event.currentTarget)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {setAside.pending ? <Spinner /> : null}
            Set aside
          </Button>
          <MutationUndo
            requestUndo={() => mutations.requestUndo(memory.id, SET_ASIDE)}
            state={setAside}
          />
        </div>
      ) : null}
      {setAside.error ? <ErrorText message={setAside.error} /> : null}
    </div>
  );
}

/**
 * The one form both adding and correcting use, so a detail is written the same
 * way whichever direction it came from.
 *
 * `expectedRevision` is dropped after a lost race, which is what turns the
 * conflict message's "save again" into a deliberate replace rather than a third
 * attempt at the same race.
 */
function MemoryForm({
  canMarkHousehold,
  draft: initialDraft,
  expectedRevision,
  members,
  onCancel,
  onSaved,
  onSubmit,
  submitLabel,
}: {
  canMarkHousehold: boolean;
  draft: MemoryDraft;
  expectedRevision?: number;
  members: ShareableActionMember[];
  onCancel: () => void;
  onSaved: (memory: AssetMemoryView) => void;
  onSubmit: (
    draft: MemoryDraft,
    household: boolean,
    expectedRevision: number | null,
  ) => Promise<AssetMemoryMutationResult>;
  submitLabel: string;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [household, setHousehold] = useState(false);
  const [replace, setReplace] = useState(false);
  const { error, pending, submit } = usePendingMutationSubmit(GENERIC_ERROR);

  const label = draft.label.trim();
  const hasContent = draft.value.trim().length > 0 || draft.notes.trim().length > 0;

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!label || !hasContent) return;
        submit(
          () =>
            onSubmit(
              { label, value: draft.value.trim(), notes: draft.notes.trim() },
              household,
              replace ? null : (expectedRevision ?? null),
            ),
          onSaved,
          (result) => {
            if (!result.conflict) return;
            // The draft stays in the fields. The member is told what the detail
            // reads now and who put it there, and the same Save replaces it.
            setReplace(true);
            const actor = members.find(
              (member) => member.userId === result.conflict?.actorUserId,
            )?.name;
            return `${actor ?? "Someone"} changed this to “${result.conflict.currentValue}”. Save again to replace it with yours.`;
          },
        );
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="What is this detail called?"
          autoFocus
          className="sm:w-48"
          onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
          placeholder="Filter size"
          value={draft.label}
        />
        <Input
          aria-label="The exact value"
          className="sm:flex-1"
          onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
          placeholder="EDR3RXD1"
          value={draft.value}
        />
      </div>
      <Textarea
        aria-label="Anything else worth remembering"
        className="min-h-16"
        onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
        placeholder="Anything else worth remembering"
        value={draft.notes}
      />

      {canMarkHousehold ? (
        <Label className="flex w-fit items-center gap-2 text-[length:var(--text-small)] font-normal text-muted-foreground">
          <Checkbox checked={household} onCheckedChange={(next) => setHousehold(next === true)} />
          Keep this for the household — anyone can correct or set it aside, and it stays if you
          leave
        </Label>
      ) : null}

      <div className="flex items-center gap-2">
        <Button disabled={pending || !label || !hasContent} size="sm" type="submit">
          {pending ? <Spinner /> : null}
          {submitLabel}
        </Button>
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}
