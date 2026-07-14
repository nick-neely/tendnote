"use client";

import type { AssetKind } from "@tendnote/domain";
import { ASSET_KIND_OPTIONS } from "@tendnote/domain";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { type Draft, PickedFileStrip } from "@/components/asset-evidence-capture";
import { ASSET_KIND_ICONS } from "@/components/asset-shared";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shimmer } from "@/components/ui/shimmer";
import {
  type EvidenceCaptureChoice,
  type EvidenceDestination,
  evidenceDestinationKey,
} from "@/lib/asset-evidence-destination";

/**
 * The destination step of Eve's chat capture (#201, PRD #196 story 26):
 * evidence is never silently misfiled, so when more than one place could take
 * this capture — or none exists yet — the user says where it belongs: an
 * existing Asset, a still-open review item, or something new that starts as a
 * review-gated suggestion.
 */
export function DestinationChooser({
  draft,
  destinations,
  loadFailed,
  onChoose,
  onClose,
}: {
  draft: Extract<Draft, { mode: "file" }>;
  destinations: EvidenceDestination[] | null;
  loadFailed: boolean;
  onChoose: (choice: EvidenceCaptureChoice) => void;
  onClose: () => void;
}) {
  const nothingYet = destinations !== null && destinations.length === 0;
  const [naming, setNaming] = useState(false);
  const newOpen = naming || nothingYet;

  return (
    <div className="flex flex-col gap-3">
      <PickedFileStrip clearLabel="Discard capture" draft={draft} onClear={onClose} />

      {loadFailed ? (
        <ErrorText message={GENERIC_ERROR} />
      ) : destinations === null ? (
        <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          <Shimmer>Finding where this belongs…</Shimmer>
        </p>
      ) : (
        <>
          {destinations.length > 0 ? (
            <DestinationList destinations={destinations} onChoose={onChoose} />
          ) : (
            <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              Tendnote isn't tracking anything yet — name what this belongs to.
            </p>
          )}

          {newOpen ? (
            <NewAssetForm
              onContinue={(assetName, assetKind) => onChoose({ kind: "new", assetName, assetKind })}
            />
          ) : (
            <Button
              className="w-fit"
              onClick={() => setNaming(true)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <PlusIcon />
              Something new
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** The candidate destinations, scrollable past a handful, each one row-button. */
function DestinationList({
  destinations,
  onChoose,
}: {
  destinations: EvidenceDestination[];
  onChoose: (choice: EvidenceCaptureChoice) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p
        className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
        id="assistant-capture-destination-label"
      >
        Where does this belong?
      </p>
      <ul
        aria-labelledby="assistant-capture-destination-label"
        className="flex max-h-44 flex-col gap-1 overflow-y-auto"
      >
        {destinations.map((destination) => (
          <li key={evidenceDestinationKey(destination)}>
            <DestinationRow
              destination={destination}
              onChoose={() => onChoose({ kind: "existing", destination })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One place the capture could land, as a single quiet row-button. */
function DestinationRow({
  destination,
  onChoose,
}: {
  destination: EvidenceDestination;
  onChoose: () => void;
}) {
  const isAsset = destination.targetKind === "asset";
  const name = isAsset ? destination.name : destination.assetName;
  const KindIcon = ASSET_KIND_ICONS[destination.kind];

  return (
    <button
      className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left transition-colors duration-150 hover:border-ring/60 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
      onClick={onChoose}
      type="button"
    >
      <KindIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-[length:var(--text-small)] font-medium">
        {name}
      </span>
      <span className="shrink-0 text-[length:var(--text-caption)] text-muted-foreground">
        {isAsset ? destination.visibilityLabel : "Waiting in Review"}
      </span>
    </button>
  );
}

/**
 * Naming something new: the smallest anchor a proposal needs — a name and a
 * kind. It stays a suggestion until the Review Queue confirms it (#196).
 */
function NewAssetForm({
  onContinue,
}: {
  onContinue: (assetName: string, assetKind: AssetKind) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("item");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="New asset name"
          className="sm:flex-1"
          onChange={(event) => setName(event.target.value)}
          placeholder="What does this belong to?"
          value={name}
        />
        <Select onValueChange={(next) => setKind(next as AssetKind)} value={kind}>
          <SelectTrigger aria-label="New asset kind" className="min-w-36">
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
        <Button
          disabled={name.trim() === ""}
          onClick={() => onContinue(name.trim(), kind)}
          size="sm"
          type="button"
        >
          Continue
        </Button>
      </div>
      <p className="text-[length:var(--text-caption)] text-muted-foreground">
        New things start as suggestions — you'll confirm this in Review before it becomes an asset.
      </p>
    </div>
  );
}
