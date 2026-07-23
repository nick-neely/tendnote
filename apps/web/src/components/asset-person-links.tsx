"use client";

import type { AssetPersonRelation } from "@tendnote/domain";
import { ASSET_PERSON_RELATION_OPTIONS } from "@tendnote/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { addAssetPersonLinkAction, removeAssetPersonLinkAction } from "@/app/actions/asset-links";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { XIcon } from "@/components/icons";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { AssetLinkMutationResult, AssetPersonLinkView } from "@/lib/asset-link-view";
import { useMutationSubmit } from "@/lib/use-mutation-submit";

/** One of the viewer's people, offered by the add form: id + name only. */
export type LinkablePersonOption = { id: string; displayName: string };

/**
 * The Asset Profile's People section (#202): contextual person links — who
 * recommended, borrowed, uses, stores, services, or knows about this asset.
 * Each row reads "‹Marcus› — borrowed it" and deep-links to the person. Links
 * are the viewer's own (people are theirs alone) and never make anyone an
 * owner or widen who can see the asset.
 */
export function AssetPersonLinks({
  assetId,
  links,
  people,
  canLink,
}: {
  assetId: string;
  links: AssetPersonLinkView[];
  /** The viewer's own people, for the add form. */
  people: LinkablePersonOption[];
  /** Linking needs the asset active; viewers of an archive just read. */
  canLink: boolean;
}) {
  // Removing the row a keyboard user was standing on would drop focus to <body>;
  // the section takes it back so the next Tab continues where they were.
  const sectionRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="flex flex-col gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      ref={sectionRef}
      tabIndex={-1}
    >
      {links.length > 0 ? (
        <LedgerList>
          {links.map((link) => (
            <AssetPersonLinkRow
              key={link.linkId}
              link={link}
              onRemoved={() => sectionRef.current?.focus()}
            />
          ))}
        </LedgerList>
      ) : (
        <LedgerEmpty>No people linked yet.</LedgerEmpty>
      )}
      {canLink && people.length > 0 ? (
        <AddAssetPersonLinkForm assetId={assetId} people={people} />
      ) : null}
    </div>
  );
}

/**
 * One person row, read as one sentence — "Alex Morgan recommended it." — with
 * the name as the link. The relation is prose, never a mono chip: mono is
 * reserved for machine facts (DESIGN.md §4), and a related-asset link next to it
 * already reads as a plain sentence. Removal stays inline.
 */
function AssetPersonLinkRow({
  link,
  onRemoved,
}: {
  link: AssetPersonLinkView;
  onRemoved: () => void;
}) {
  const router = useRouter();
  const { error, pending, submit } = useMutationSubmit(GENERIC_ERROR);

  function remove() {
    submit(
      () => removeAssetPersonLinkAction({ linkId: link.linkId }),
      () => {
        onRemoved();
        router.refresh();
      },
    );
  }

  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          <Link
            className="rounded-sm font-medium underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href={`/people/${link.personId}`}
          >
            {link.displayName}
          </Link>{" "}
          {link.relationLabel}.
        </p>
        <Button
          aria-label={`Remove link to ${link.displayName}`}
          className="shrink-0"
          disabled={pending}
          onClick={remove}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {pending ? <Spinner /> : <XIcon />}
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}

/** The add form, sentence-shaped: "‹Person› ‹relation›" → Link. */
function AddAssetPersonLinkForm({
  assetId,
  people,
}: {
  assetId: string;
  people: LinkablePersonOption[];
}) {
  const router = useRouter();
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const [relation, setRelation] = useState<AssetPersonRelation>("recommended");
  const { error, pending, submit } = useMutationSubmit(GENERIC_ERROR);

  function add() {
    if (!personId) {
      return;
    }
    submit(
      (): Promise<AssetLinkMutationResult> =>
        addAssetPersonLinkAction({ assetId, personId, relation }),
      () => router.refresh(),
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select onValueChange={setPersonId} value={personId}>
          <SelectTrigger aria-label="Person to link" className="w-fit min-w-36" size="sm">
            <SelectValue placeholder="Someone" />
          </SelectTrigger>
          <SelectContent>
            {people.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select onValueChange={(next) => setRelation(next as AssetPersonRelation)} value={relation}>
          <SelectTrigger aria-label="Relation" className="w-fit min-w-32" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSET_PERSON_RELATION_OPTIONS.map((option) => (
              <SelectItem key={option.relation} value={option.relation}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button disabled={pending || !personId} size="sm" type="submit" variant="outline">
          {pending ? <Spinner /> : null}
          Link
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}
