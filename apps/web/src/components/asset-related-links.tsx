"use client";

import type { AssetLinkRelation } from "@tendnote/domain";
import { ASSET_LINK_RELATION_OPTIONS } from "@tendnote/domain";
import { CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  acceptSuggestedAssetLinkAction,
  addAssetLinkAction,
  dismissSuggestedAssetLinkAction,
  removeAssetLinkAction,
} from "@/app/actions/asset-links";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { AssetLinkMutationResult, RelatedAssetLinkView } from "@/lib/asset-link-view";
import { useMutationSubmit } from "@/lib/use-mutation-submit";

/** One linkable candidate for the add form: id + name, nothing more. */
export type LinkableAssetOption = { id: string; name: string };

/**
 * The Asset Profile's Related Asset Links section (#202): each link is one calm
 * sentence — "Fits ‹Refrigerator›" outgoing, "‹Water filter› fits this"
 * incoming — deep-linking to the other profile. Pending inferred suggestions are
 * review-gated inline (accept or set aside, owner-only); owners can remove their
 * links; and the add form composes the same sentence it will create. Context
 * only, never a graph — the fixed relation set is the whole vocabulary.
 */
export function AssetRelatedLinks({
  assetId,
  links,
  linkableAssets,
  canLink,
}: {
  assetId: string;
  links: RelatedAssetLinkView[];
  /** Caller-visible active assets this one could link to (never itself). */
  linkableAssets: LinkableAssetOption[];
  /** Linking outward needs the asset active; viewers of an archive just read. */
  canLink: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {links.length > 0 ? (
        <LedgerList>
          {links.map((link) => (
            <RelatedAssetLinkRow key={link.linkId} link={link} />
          ))}
        </LedgerList>
      ) : (
        <LedgerEmpty>
          No related assets yet. Link the filter that fits this, the part it uses, or the thing it's
          stored with.
        </LedgerEmpty>
      )}
      {canLink && linkableAssets.length > 0 ? (
        <AddAssetLinkForm assetId={assetId} linkableAssets={linkableAssets} />
      ) : null}
    </div>
  );
}

/** Runs a link mutation and refreshes the server-rendered profile on success. */
function useLinkMutation() {
  const router = useRouter();
  const { error, pending, submit } = useMutationSubmit(GENERIC_ERROR);

  function run(action: () => Promise<AssetLinkMutationResult>, after?: () => void): void {
    submit(action, () => {
      after?.();
      router.refresh();
    });
  }

  return { error, pending, run };
}

/**
 * One link row: the sentence with the other asset's name as the link, a quiet
 * "Suggested" cue with inline review for a pending inference, and removal for
 * the link's owner. Resolved without dialogs — review is two small words.
 */
function RelatedAssetLinkRow({ link }: { link: RelatedAssetLinkView }) {
  const { error, pending, run } = useLinkMutation();

  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          {link.phraseBefore}
          <Link
            className="rounded-sm font-medium underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href={`/assets/${link.otherAssetId}`}
          >
            {link.otherAssetName}
          </Link>
          {link.phraseAfter}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {link.pending ? <Badge variant="outline">Suggested</Badge> : null}
          {link.owned && !link.pending ? (
            <Button
              aria-label={`Remove link to ${link.otherAssetName}`}
              disabled={pending}
              onClick={() => run(() => removeAssetLinkAction({ linkId: link.linkId }))}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              {pending ? <Spinner /> : <XIcon />}
            </Button>
          ) : null}
        </div>
      </div>
      {link.pending && link.owned ? (
        <div className="flex items-center gap-2">
          <Button
            disabled={pending}
            onClick={() => run(() => acceptSuggestedAssetLinkAction({ linkId: link.linkId }))}
            size="sm"
            type="button"
            variant="outline"
          >
            {pending ? <Spinner /> : <CheckIcon />}
            Add link
          </Button>
          <Button
            disabled={pending}
            onClick={() => run(() => dismissSuggestedAssetLinkAction({ linkId: link.linkId }))}
            size="sm"
            type="button"
            variant="ghost"
          >
            Set aside
          </Button>
        </div>
      ) : null}
      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}

/**
 * The add form, shaped like the sentence it creates: "This ‹relation› ‹asset›".
 * Both selects default sensibly so linking the common case is two clicks.
 */
function AddAssetLinkForm({
  assetId,
  linkableAssets,
}: {
  assetId: string;
  linkableAssets: LinkableAssetOption[];
}) {
  const [relation, setRelation] = useState<AssetLinkRelation>("fits");
  const [toAssetId, setToAssetId] = useState(linkableAssets[0]?.id ?? "");
  const { error, pending, run } = useLinkMutation();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!toAssetId) {
          return;
        }
        run(() => addAssetLinkAction({ fromAssetId: assetId, toAssetId, relation }));
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[length:var(--text-small)] text-muted-foreground">This</span>
        <Select onValueChange={(next) => setRelation(next as AssetLinkRelation)} value={relation}>
          <SelectTrigger aria-label="Relation" className="w-fit min-w-28" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSET_LINK_RELATION_OPTIONS.map((option) => (
              <SelectItem key={option.relation} value={option.relation}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select onValueChange={setToAssetId} value={toAssetId}>
          <SelectTrigger aria-label="Asset to link" className="w-fit min-w-40" size="sm">
            <SelectValue placeholder="an asset" />
          </SelectTrigger>
          <SelectContent>
            {linkableAssets.map((asset) => (
              <SelectItem key={asset.id} value={asset.id}>
                {asset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button disabled={pending || !toAssetId} size="sm" type="submit" variant="outline">
          {pending ? <Spinner /> : null}
          Link
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}
