import type { SharedRelationshipRecordView } from "@tendnote/domain";
import { RELATIONSHIP_RECORD_NOUN } from "@tendnote/domain";
import { HomeIcon, UsersIcon } from "@/components/icons";
import { formatShortDate } from "@/lib/person-format";

/** Sentence-case the record's own noun for a heading. */
function recordHeading(view: SharedRelationshipRecordView): string {
  const noun = RELATIONSHIP_RECORD_NOUN[view.recordKind];
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

/**
 * One shared relationship record, alone on a page.
 *
 * The composition is the privacy argument. There is no sidebar of the person's
 * other records, no count of what else exists, no link into a profile, and no
 * way to act on it — because a page that offered any of those would be a dossier
 * on someone the reader was shown one fact about (PRODUCT.md anti-references;
 * ADR 0218). What is here is what the owner deliberately handed over: the
 * record, who it is about, when it was recorded, and who shared it.
 *
 * The envelope it renders structurally cannot carry more than that, so this
 * component has nothing to withhold — it renders every field it is given.
 */
export function SharedRelationshipRecord({ view }: { view: SharedRelationshipRecordView }) {
  const AudienceIcon = view.audience === "whole_household" ? HomeIcon : UsersIcon;

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <p className="text-[length:var(--text-small)] text-muted-foreground">
          {recordHeading(view)}
          {view.personLabel ? ` about ${view.personLabel}` : ""}
        </p>
        {/*
          The provenance line is the one piece of social information here, and
          it is stated as fact rather than as an invitation to reply: nobody is
          asking the reader for anything.
        */}
        <p className="flex items-center gap-1.5 text-[length:var(--text-small)] text-muted-foreground">
          {/* The audience glyph is for the audience. An owner reaching their own
              record here may be reaching a still-private one, and a household
              glyph beside it would state something untrue. */}
          {view.viewerIsOwner ? null : <AudienceIcon aria-hidden className="size-3.5 shrink-0" />}
          {view.viewerIsOwner ? "Shared by you" : `Shared by ${view.sharedByName}`}
          {/*
            The read-only contract, where a first-time reader actually arrives.
            The fuller statement is in the footer, but a short record on a phone
            can be read and left without ever scrolling that far.
          */}
          {view.viewerIsOwner ? null : <span> · Yours to read, not to change.</span>}
        </p>
      </header>

      <p className="max-w-[68ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
        {view.body}
      </p>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[length:var(--text-caption)] text-muted-foreground">
        <span>{formatShortDate(view.recordedAt)}</span>
        {view.trust ? <span>· {view.trust} confidence</span> : null}
        {view.dueAt ? <span>· due {formatShortDate(view.dueAt)}</span> : null}
      </p>

      {/*
        Read-only is stated, not merely implied by the absence of buttons. A
        reader who wants to add to this needs to know the record stays its
        owner's, and that the place for their own contribution is a
        household-native record (ADR 0218).
      */}
      {view.viewerIsOwner ? null : (
        <p className="max-w-[65ch] rounded-lg border border-dashed px-4 py-3 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          This stays {view.sharedByName}&rsquo;s to edit or take back. Anything you want to add
          belongs on a household record of your own.
        </p>
      )}
    </article>
  );
}

/**
 * The single answer to every way a shared record can be out of reach: not
 * shared, never existed, shared then taken back, or shared with someone who has
 * since left the household. They read identically on purpose — the difference
 * between them is the protected fact (ADR 0219).
 */
export function SharedRelationshipRecordUnavailable() {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
        That&rsquo;s no longer available
      </h1>
      <p className="max-w-[65ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
        Nothing here to show you.
      </p>
    </div>
  );
}
