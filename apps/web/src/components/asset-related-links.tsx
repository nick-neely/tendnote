"use client";

import type { AssetLinkRelation } from "@tendnote/domain";
import { ASSET_LINK_RELATION_OPTIONS } from "@tendnote/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  acceptSuggestedAssetLinkAction,
  addAssetLinkAction,
  dismissSuggestedAssetLinkAction,
  removeAssetLinkAction,
} from "@/app/actions/asset-links";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { CheckIcon, XIcon } from "@/components/icons";
import { LedgerList } from "@/components/person-ledger";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { AssetLinkMutationResult, RelatedAssetLinkView } from "@/lib/asset-link-view";
import { usePendingMutationSubmit } from "@/lib/reversible-mutation";

/** One linkable candidate for the add form: id + name, nothing more. */
export type LinkableAssetOption = { id: string; name: string };

/**
 * The Asset Profile's Related Asset Links section (#202): each link is one calm
 * sentence — "Fits ‹Refrigerator›" outgoing, "‹Water filter› fits this"
 * incoming — deep-linking to the other profile. Confirmed context reads as the
 * ledger; pending inferred suggestions sit apart in their own clay strip, the
 * repo's reserved review-needed color (DESIGN.md §3), so what Tendnote *thinks*
 * never reads at the weight of what the user has confirmed. Owners can remove
 * their links, and the add form composes the same sentence it will create.
 * Context only, never a graph — the fixed relation set is the whole vocabulary.
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
  // Resolving or removing a row takes its buttons out of the document; the
  // section catches focus so a keyboard user is never dropped back to <body>.
  const sectionRef = useRef<HTMLDivElement>(null);
  const restoreFocus = () => sectionRef.current?.focus();
  const confirmed = links.filter((link) => !link.pending);
  const suggested = links.filter((link) => link.pending);

  return (
    <div
      className="flex flex-col gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      ref={sectionRef}
      tabIndex={-1}
    >
      {confirmed.length > 0 ? (
        <LedgerList>
          {confirmed.map((link) => (
            <RelatedAssetLinkRow key={link.linkId} link={link} onResolved={restoreFocus} />
          ))}
        </LedgerList>
      ) : suggested.length === 0 ? (
        <EmptyState
          description="Link what this fits, uses, replaces, covers, or is stored with."
          size="compact"
          title="No related assets yet."
        />
      ) : null}

      {suggested.length > 0 ? <SuggestedLinks links={suggested} onResolved={restoreFocus} /> : null}

      {canLink && linkableAssets.length > 0 ? (
        <AddAssetLinkForm assetId={assetId} linkableAssets={linkableAssets} />
      ) : null}
    </div>
  );
}

/**
 * The pending inferences, held apart from confirmed context and marked in clay —
 * the one color reserved for review-needed state. Nothing here is part of the
 * asset's story until the owner says so, and the copy says exactly that.
 */
function SuggestedLinks({
  links,
  onResolved,
}: {
  links: RelatedAssetLinkView[];
  onResolved: () => void;
}) {
  return (
    <section
      aria-label="Suggested links"
      className="flex flex-col gap-3 rounded-xl border border-accent/25 bg-accent-soft/45 px-4 py-3.5"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          Suggested
        </span>
        <p className="text-[length:var(--text-caption)] text-muted-foreground">
          Nothing is linked until you say so.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-accent/20">
        {links.map((link) => (
          <li className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0" key={link.linkId}>
            <SuggestedLinkRow link={link} onResolved={onResolved} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One pending suggestion: the sentence it proposes, then two small words. */
function SuggestedLinkRow({
  link,
  onResolved,
}: {
  link: RelatedAssetLinkView;
  onResolved: () => void;
}) {
  const { error, pending, run } = useLinkMutation();

  return (
    <>
      <LinkSentence link={link} />
      {link.owned ? (
        <div className="flex items-center gap-1.5">
          <Button
            disabled={pending}
            onClick={() =>
              run(() => acceptSuggestedAssetLinkAction({ linkId: link.linkId }), onResolved)
            }
            size="sm"
            type="button"
            variant="outline"
          >
            {pending ? <Spinner /> : <CheckIcon />}
            Add link
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              run(() => dismissSuggestedAssetLinkAction({ linkId: link.linkId }), onResolved)
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            Set aside
          </Button>
        </div>
      ) : null}
      {error ? <ErrorText message={error} /> : null}
    </>
  );
}

/** The link as one plain sentence, the other asset's name carrying the hop. */
function LinkSentence({ link }: { link: RelatedAssetLinkView }) {
  return (
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
  );
}

/** Runs a link mutation and refreshes the server-rendered profile on success. */
function useLinkMutation() {
  const router = useRouter();
  const { error, pending, submit } = usePendingMutationSubmit(GENERIC_ERROR);

  function run(action: () => Promise<AssetLinkMutationResult>, after?: () => void): void {
    submit(action, () => {
      after?.();
      router.refresh();
    });
  }

  return { error, pending, run };
}

/**
 * One confirmed link row: the sentence with the other asset's name as the link,
 * and removal for the link's owner. Pending inferences never render here — they
 * live in the clay suggestions strip until the owner resolves them.
 */
function RelatedAssetLinkRow({
  link,
  onResolved,
}: {
  link: RelatedAssetLinkView;
  onResolved: () => void;
}) {
  const { error, pending, run } = useLinkMutation();

  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <LinkSentence link={link} />
        {link.owned ? (
          <Button
            aria-label={`Remove link to ${link.otherAssetName}`}
            className="shrink-0"
            disabled={pending}
            onClick={() => run(() => removeAssetLinkAction({ linkId: link.linkId }), onResolved)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {pending ? <Spinner /> : <XIcon />}
          </Button>
        ) : null}
      </div>
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
